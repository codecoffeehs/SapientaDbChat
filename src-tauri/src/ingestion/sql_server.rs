use super::models::{Entity, Field, Relationship};
use std::collections::BTreeMap;
use tiberius::Client;
use tokio::net::TcpStream;
use tokio_util::compat::Compat;

type SqlClient = Client<Compat<TcpStream>>;

pub async fn list(client: &mut SqlClient) -> Result<Vec<Entity>, String> {
    let rows = client.simple_query(
        "SELECT s.name AS schema_name, t.name AS table_name FROM sys.tables t
         JOIN sys.schemas s ON s.schema_id = t.schema_id WHERE t.is_ms_shipped = 0 ORDER BY s.name, t.name",
    ).await.map_err(|_| "Could not list SQL Server tables.")?.into_first_result().await
        .map_err(|_| "Could not read SQL Server table metadata.")?;
    rows.iter()
        .map(|row| {
            Ok(Entity::new(
                row.get::<&str, _>("schema_name")
                    .ok_or("Missing schema name.")?
                    .into(),
                row.get::<&str, _>("table_name")
                    .ok_or("Missing table name.")?
                    .into(),
            ))
        })
        .collect()
}

pub async fn metadata(client: &mut SqlClient, entities: &mut [Entity]) -> Result<(), String> {
    let rows = client.query(
        "SELECT c.name AS column_name, ty.name AS data_type, c.is_nullable,
            CAST(CASE WHEN EXISTS(SELECT 1 FROM sys.index_columns ic JOIN sys.indexes i
                ON i.object_id=ic.object_id AND i.index_id=ic.index_id
                WHERE ic.object_id=c.object_id AND ic.column_id=c.column_id AND i.is_primary_key=1) THEN 1 ELSE 0 END AS bit) AS primary_key,
            CAST(ep.value AS nvarchar(4000)) AS description, s.name AS source_schema, t.name AS source_table
         FROM sys.columns c JOIN sys.tables t ON t.object_id=c.object_id
         JOIN sys.schemas s ON s.schema_id=t.schema_id JOIN sys.types ty ON ty.user_type_id=c.user_type_id
         LEFT JOIN sys.extended_properties ep ON ep.major_id=c.object_id AND ep.minor_id=c.column_id AND ep.class=1 AND ep.name='MS_Description'
         WHERE t.is_ms_shipped=0 ORDER BY c.column_id", &[],
    ).await.map_err(|_| "Could not read column metadata.")?.into_first_result().await.map_err(|_| "Could not read columns.")?;
    let relationships = client.query(
        "SELECT fk.name AS constraint_name, sc.name AS source_column, ts.name AS target_schema,
            tt.name AS target_table, tc.name AS target_column, ss.name AS source_schema, st.name AS source_table
         FROM sys.foreign_keys fk JOIN sys.foreign_key_columns fkc ON fkc.constraint_object_id=fk.object_id
         JOIN sys.tables st ON st.object_id=fkc.parent_object_id JOIN sys.schemas ss ON ss.schema_id=st.schema_id
         JOIN sys.columns sc ON sc.object_id=st.object_id AND sc.column_id=fkc.parent_column_id
         JOIN sys.tables tt ON tt.object_id=fkc.referenced_object_id JOIN sys.schemas ts ON ts.schema_id=tt.schema_id
         JOIN sys.columns tc ON tc.object_id=tt.object_id AND tc.column_id=fkc.referenced_column_id
         WHERE st.is_ms_shipped=0 ORDER BY fk.name, fkc.constraint_column_id", &[],
    ).await.map_err(|_| "Could not read foreign keys.")?.into_first_result().await.map_err(|_| "Could not read foreign keys.")?;
    let mut columns_by_table: std::collections::HashMap<(String, String), Vec<_>> =
        std::collections::HashMap::new();
    for row in rows {
        columns_by_table
            .entry((
                row.get::<&str, _>("source_schema")
                    .unwrap_or_default()
                    .into(),
                row.get::<&str, _>("source_table")
                    .unwrap_or_default()
                    .into(),
            ))
            .or_default()
            .push(row);
    }
    let mut relations_by_table: std::collections::HashMap<(String, String), Vec<_>> =
        std::collections::HashMap::new();
    for row in relationships {
        relations_by_table
            .entry((
                row.get::<&str, _>("source_schema")
                    .unwrap_or_default()
                    .into(),
                row.get::<&str, _>("source_table")
                    .unwrap_or_default()
                    .into(),
            ))
            .or_default()
            .push(row);
    }
    for entity in entities.iter_mut() {
        let key = (entity.schema.clone(), entity.name.clone());
        let rows = columns_by_table.remove(&key).unwrap_or_default();
        entity.fields = rows
            .iter()
            .map(|row| Field {
                name: row.get::<&str, _>("column_name").unwrap_or_default().into(),
                data_type: row.get::<&str, _>("data_type").unwrap_or("unknown").into(),
                nullable: row.get("is_nullable").unwrap_or(true),
                primary_key: row.get("primary_key").unwrap_or(false),
                comment: row.get::<&str, _>("description").map(str::to_owned),
            })
            .collect();
        let rows = relations_by_table.remove(&key).unwrap_or_default();
        let mut relations: BTreeMap<String, Relationship> = BTreeMap::new();
        for row in rows {
            let relation = relations
                .entry(
                    row.get::<&str, _>("constraint_name")
                        .unwrap_or_default()
                        .into(),
                )
                .or_insert_with(|| Relationship {
                    columns: vec![],
                    target_schema: row
                        .get::<&str, _>("target_schema")
                        .unwrap_or_default()
                        .into(),
                    target_table: row
                        .get::<&str, _>("target_table")
                        .unwrap_or_default()
                        .into(),
                    target_columns: vec![],
                });
            relation.columns.push(
                row.get::<&str, _>("source_column")
                    .unwrap_or_default()
                    .into(),
            );
            relation.target_columns.push(
                row.get::<&str, _>("target_column")
                    .unwrap_or_default()
                    .into(),
            );
        }
        entity.relationships = relations.into_values().collect();
        entity.notes.push("Structure and foreign keys come from SQL Server catalogs. Presence uses EXISTS; row values are not collected.".into());
    }
    Ok(())
}

pub async fn presence(client: &mut SqlClient, entities: &[Entity]) -> Result<Vec<bool>, String> {
    let query = entities.iter().enumerate().map(|(index, entity)| {
        let table = format!("[{}].[{}]", entity.schema.replace(']', "]]"), entity.name.replace(']', "]]"));
        format!("SELECT {index} AS item, CAST(CASE WHEN EXISTS(SELECT 1 FROM {table}) THEN 1 ELSE 0 END AS bit) AS present")
    }).collect::<Vec<_>>().join(" UNION ALL ");
    let rows = client
        .simple_query(format!("SELECT * FROM ({query}) AS checks ORDER BY item"))
        .await
        .map_err(|_| "Batch presence check failed.")?
        .into_first_result()
        .await
        .map_err(|_| "Batch presence check failed.")?;
    if rows.len() != entities.len() {
        return Err("Incomplete presence check.".into());
    }
    rows.iter()
        .map(|row| {
            row.get::<bool, _>("present")
                .ok_or_else(|| "Missing presence result.".into())
        })
        .collect()
}
