use super::models::{Entity, Field, Relationship};
use tokio_postgres::Client;

pub async fn list(client: &Client) -> Result<Vec<Entity>, String> {
    let rows = client.query(
        "SELECT n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition
         AND n.nspname NOT IN ('information_schema', 'pg_catalog') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
         ORDER BY n.nspname, c.relname", &[],
    ).await.map_err(|_| "Could not list PostgreSQL tables. Check catalog permissions.")?;
    Ok(rows
        .iter()
        .map(|row| Entity::new(row.get(0), row.get(1)))
        .collect())
}

pub async fn metadata(client: &Client, entities: &mut [Entity]) -> Result<(), String> {
    let rows = client.query(
        "SELECT a.attname, format_type(a.atttypid, a.atttypmod), NOT a.attnotnull,
            EXISTS(SELECT 1 FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype = 'p' AND a.attnum = ANY(k.conkey)),
            col_description(c.oid, a.attnum), n.nspname AS source_schema, c.relname AS source_table
         FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relkind IN ('r', 'p') AND NOT c.relispartition AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum",
        &[],
    ).await.map_err(|_| "Could not read PostgreSQL column metadata.")?;
    let relations = client.query(
        "SELECT k.conname, tn.nspname, tc.relname,
            array_agg(sa.attname::text ORDER BY pair.ord), array_agg(ta.attname::text ORDER BY pair.ord), sn.nspname AS source_schema, sc.relname AS source_table
         FROM pg_constraint k JOIN pg_class sc ON sc.oid = k.conrelid JOIN pg_namespace sn ON sn.oid = sc.relnamespace
         JOIN pg_class tc ON tc.oid = k.confrelid JOIN pg_namespace tn ON tn.oid = tc.relnamespace
         CROSS JOIN LATERAL unnest(k.conkey, k.confkey) WITH ORDINALITY AS pair(src, dst, ord)
         JOIN pg_attribute sa ON sa.attrelid = sc.oid AND sa.attnum = pair.src
         JOIN pg_attribute ta ON ta.attrelid = tc.oid AND ta.attnum = pair.dst
         WHERE k.contype = 'f'
         GROUP BY k.oid, k.conname, tn.nspname, tc.relname, sn.nspname, sc.relname ORDER BY k.conname",
        &[],
    ).await.map_err(|_| "Could not read PostgreSQL foreign keys.")?;
    let mut columns_by_table: std::collections::HashMap<(String, String), Vec<_>> =
        std::collections::HashMap::new();
    for row in rows {
        columns_by_table
            .entry((row.get("source_schema"), row.get("source_table")))
            .or_default()
            .push(row);
    }
    let mut relations_by_table: std::collections::HashMap<(String, String), Vec<_>> =
        std::collections::HashMap::new();
    for row in relations {
        relations_by_table
            .entry((row.get("source_schema"), row.get("source_table")))
            .or_default()
            .push(row);
    }
    for entity in entities.iter_mut() {
        let key = (entity.schema.clone(), entity.name.clone());
        let rows = columns_by_table.remove(&key).unwrap_or_default();
        let relations = relations_by_table.remove(&key).unwrap_or_default();
        entity.fields = rows
            .iter()
            .map(|row| Field {
                name: row.get(0),
                data_type: row.get(1),
                nullable: row.get(2),
                primary_key: row.get(3),
                comment: row.get(4),
            })
            .collect();
        entity.relationships = relations
            .iter()
            .map(|row| Relationship {
                columns: row.get(3),
                target_schema: row.get(1),
                target_table: row.get(2),
                target_columns: row.get(4),
            })
            .collect();
        entity.notes.push("Structure and foreign keys come from PostgreSQL catalogs. Presence is checked with EXISTS; row values are not collected.".into());
    }
    Ok(())
}

// Exact presence checks in one round trip; planner/statistics row counts can be stale.
pub async fn presence(client: &Client, entities: &[Entity]) -> Result<Vec<bool>, String> {
    let query = entities
        .iter()
        .enumerate()
        .map(|(index, entity)| {
            let table = format!(
                "\"{}\".\"{}\"",
                entity.schema.replace('"', "\"\""),
                entity.name.replace('"', "\"\"")
            );
            format!("SELECT {index} AS item, EXISTS(SELECT 1 FROM {table} LIMIT 1) AS present")
        })
        .collect::<Vec<_>>()
        .join(" UNION ALL ");
    let rows = client
        .query(
            &format!("SELECT * FROM ({query}) AS checks ORDER BY item"),
            &[],
        )
        .await
        .map_err(|_| "Batch presence check failed.")?;
    if rows.len() != entities.len() {
        return Err("Incomplete presence check.".into());
    }
    Ok(rows.iter().map(|row| row.get::<_, bool>(1)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    // Run against a disposable database; all fixtures are rolled back.
    #[tokio::test]
    #[ignore = "requires SAPIENTA_TEST_POSTGRES_URI pointing to a disposable database"]
    async fn bulk_scan_preserves_metadata_and_exact_presence() {
        let uri = std::env::var("SAPIENTA_TEST_POSTGRES_URI").expect("test database URI");
        let (client, connection) = tokio_postgres::connect(&uri, tokio_postgres::NoTls)
            .await
            .unwrap();
        let task = tokio::spawn(async move { connection.await.unwrap() });
        client.batch_execute(r#"
            BEGIN;
            CREATE SCHEMA scan_bulk_test;
            CREATE TABLE scan_bulk_test.parent (a int, b int, PRIMARY KEY(a,b));
            CREATE TABLE scan_bulk_test.child (x int, y int,
                FOREIGN KEY(x,y) REFERENCES scan_bulk_test.parent(a,b));
            COMMENT ON COLUMN scan_bulk_test.child.x IS 'first key';
            CREATE TABLE scan_bulk_test."odd""name" (id int);
            INSERT INTO scan_bulk_test."odd""name" VALUES (1);
            CREATE TABLE scan_bulk_test.partitioned (id int) PARTITION BY RANGE(id);
            CREATE TABLE scan_bulk_test.part PARTITION OF scan_bulk_test.partitioned FOR VALUES FROM (0) TO (10);
            INSERT INTO scan_bulk_test.partitioned VALUES (1);
            DO $$ BEGIN
                FOR i IN 1..1000 LOOP
                    EXECUTE format('CREATE TABLE scan_bulk_test.%I (id int)', 'empty_' || i);
                END LOOP;
            END $$;
        "#).await.unwrap();
        let mut entities: Vec<_> = list(&client)
            .await
            .unwrap()
            .into_iter()
            .filter(|e| e.schema == "scan_bulk_test")
            .collect();
        assert_eq!(entities.len(), 1004); // Partition children must not be listed separately.
        metadata(&client, &mut entities).await.unwrap();
        for chunk in entities.chunks(128) {
            let results = presence(&client, chunk).await.unwrap();
            for (entity, present) in chunk.iter().zip(results) {
                assert_eq!(
                    present,
                    entity.name == "odd\"name" || entity.name == "partitioned"
                );
                assert!(!entity.fields.is_empty());
            }
        }
        let child = entities.iter().find(|e| e.name == "child").unwrap();
        assert_eq!(child.fields[0].comment.as_deref(), Some("first key"));
        assert_eq!(child.relationships[0].columns, ["x", "y"]);
        assert_eq!(child.relationships[0].target_columns, ["a", "b"]);
        let parent = entities.iter().find(|e| e.name == "parent").unwrap();
        assert!(parent.fields.iter().all(|f| f.primary_key));
        client.batch_execute("ROLLBACK").await.unwrap();
        drop(client);
        task.await.unwrap();
    }
}
