use crate::ingestion::models::{Entity, Run};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Column {
    #[serde(default)]
    pub label: Option<String>,
    pub table: usize,
    pub column: String,
    #[serde(default)]
    pub aggregate: Option<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Filter {
    pub table: usize,
    pub column: String,
    pub op: String,
    pub value: Value,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Join {
    #[serde(default)]
    pub kind: Option<String>,
    pub table: usize,
    pub relationship: usize,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Order {
    pub column: usize,
    pub descending: bool,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Plan {
    pub from: usize,
    pub columns: Vec<Column>,
    #[serde(default)]
    pub joins: Vec<Join>,
    #[serde(default)]
    pub filters: Vec<Filter>,
    #[serde(default)]
    pub order: Vec<Order>,
    pub limit: usize,
}

pub fn entity<'a>(run: &'a Run, allowed: &[usize], index: usize) -> Result<&'a Entity, String> {
    if !allowed.contains(&index) {
        return Err(
            "The AI chose a table outside the retrieved catalog. Ask a more specific question."
                .into(),
        );
    }
    run.entities
        .get(index)
        .filter(|e| e.status == "done" && !e.excluded)
        .ok_or_else(|| "The chosen table is not ready for chat. Check ingestion results.".into())
}
fn column(run: &Run, allowed: &[usize], table: usize, name: &str) -> Result<(), String> {
    if !entity(run, allowed, table)?
        .fields
        .iter()
        .any(|f| f.name == name)
    {
        return Err(format!(
            "The AI referred to an unknown field: {name}. No query was run."
        ));
    }
    Ok(())
}
pub fn quote(name: &str, provider: &str) -> String {
    if provider == "sqlserver" {
        format!("[{}]", name.replace(']', "]]"))
    } else {
        format!("\"{}\"", name.replace('"', "\"\""))
    }
}
fn reference(table: usize, name: &str, provider: &str) -> String {
    format!("t{table}.{}", quote(name, provider))
}
fn table_name(e: &Entity, provider: &str) -> String {
    format!(
        "{}.{}",
        quote(&e.schema, provider),
        quote(&e.name, provider)
    )
}
fn literal(value: &Value, provider: &str) -> Result<String, String> {
    match value {
        Value::String(s) if s.len() <= 1000 && !s.contains('\0') => {
            if provider == "sqlserver" {
                Ok(format!("N'{}'", s.replace('\'', "''")))
            } else {
                Ok(format!(
                    "E'{}'",
                    s.replace('\\', "\\\\").replace('\'', "''")
                ))
            }
        }
        Value::Number(n) => Ok(n.to_string()),
        Value::Bool(b) => Ok(if provider == "sqlserver" {
            if *b {
                "1"
            } else {
                "0"
            }
        } else if *b {
            "TRUE"
        } else {
            "FALSE"
        }
        .into()),
        _ => Err("A filter needs a simple text, number or boolean value.".into()),
    }
}

pub fn compile(plan: &Plan, run: &Run, allowed: &[usize]) -> Result<String, String> {
    if plan.columns.is_empty()
        || plan.columns.len() > 20
        || plan.filters.len() > 20
        || plan.joins.len() > 8
        || !(1..=200).contains(&plan.limit)
    {
        return Err("Ask for 1–200 rows, up to 20 fields and no more than eight joins.".into());
    }
    let provider = &run.provider;
    let base = entity(run, allowed, plan.from)?;
    let mut joined = HashSet::from([plan.from]);
    let mut joins = String::new();
    for edge in &plan.joins {
        let join_kind = match edge.kind.as_deref() {
            None | Some("inner") => "JOIN",
            Some("left") => "LEFT JOIN",
            _ => return Err("The AI requested an unsupported join type.".into()),
        };
        let source = entity(run, allowed, edge.table)?;
        let relation = source
            .relationships
            .get(edge.relationship)
            .ok_or("The AI chose an unknown relationship. No query was run.")?;
        let target_index = run
            .entities
            .iter()
            .position(|e| e.schema == relation.target_schema && e.name == relation.target_table)
            .ok_or("The related table is not available.")?;
        let target = entity(run, allowed, target_index)?;
        if relation.columns.is_empty() || relation.columns.len() != relation.target_columns.len() {
            return Err("This relationship has incomplete join keys.".into());
        }
        let next = match (joined.contains(&edge.table), joined.contains(&target_index)) {
            (true, false) => target_index,
            (false, true) => edge.table,
            _ => {
                return Err(
                    "The selected joins are disconnected or repeated. No query was run.".into(),
                );
            }
        };
        // Reject aggregate joins that can multiply rows. Composite uniqueness is checked as a set.
        if plan
            .columns
            .iter()
            .any(|c| matches!(c.aggregate.as_deref(), Some("sum" | "avg" | "count")))
        {
            let next_entity = if next == target_index { target } else { source };
            let keys = if next == target_index {
                &relation.target_columns
            } else {
                &relation.columns
            };
            let primary: Vec<_> = next_entity
                .fields
                .iter()
                .filter(|f| f.primary_key)
                .map(|f| &f.name)
                .collect();
            if primary.is_empty() || !primary.iter().all(|key| keys.contains(key)) {
                return Err("This join could count the same record more than once. Ask to calculate the measure from the detailed table, or clarify the intended calculation.".into());
            }
        }
        let mut conditions = Vec::new();
        for (left, right) in relation.columns.iter().zip(&relation.target_columns) {
            column(run, allowed, edge.table, left)?;
            column(run, allowed, target_index, right)?;
            conditions.push(format!(
                "{} = {}",
                reference(edge.table, left, provider),
                reference(target_index, right, provider)
            ));
        }
        joins.push_str(&format!(
            " {join_kind} {} t{next} ON {}",
            table_name(entity(run, allowed, next)?, provider),
            conditions.join(" AND ")
        ));
        joined.insert(next);
    }
    let mut expressions = Vec::new();
    let mut groups = Vec::new();
    let aggregated = plan.columns.iter().any(|c| c.aggregate.is_some());
    for (i, c) in plan.columns.iter().enumerate() {
        column(run, allowed, c.table, &c.column)?;
        if !joined.contains(&c.table) {
            return Err("A selected field is missing a relationship to the main table.".into());
        }
        let field = reference(c.table, &c.column, provider);
        let expr = match c.aggregate.as_deref() {
            None => {
                groups.push(field.clone());
                field
            }
            Some("sum" | "avg" | "min" | "max" | "count") => {
                format!("{}({field})", c.aggregate.as_ref().unwrap().to_uppercase())
            }
            Some("count_distinct") => format!("COUNT(DISTINCT {field})"),
            _ => return Err("The AI requested an unsupported calculation.".into()),
        };
        // A measure from a dimension is repeated per base row even on many-to-one joins.
        if matches!(c.aggregate.as_deref(), Some("sum" | "avg" | "count")) && c.table != plan.from {
            return Err("Calculate totals from the table that owns the measure to avoid counting records twice.".into());
        }
        expressions.push(format!("{expr} AS c{i}"));
    }
    let mut predicates = Vec::new();
    for f in &plan.filters {
        column(run, allowed, f.table, &f.column)?;
        if !joined.contains(&f.table) {
            return Err("A filter uses a table without a valid join.".into());
        }
        let field = reference(f.table, &f.column, provider);
        let predicate = match f.op.as_str() {
            "is_null" => format!("{field} IS NULL"),
            "not_null" => format!("{field} IS NOT NULL"),
            "eq" | "ne" | "gt" | "gte" | "lt" | "lte" => {
                let op = match f.op.as_str() {
                    "eq" => "=",
                    "ne" => "<>",
                    "gt" => ">",
                    "gte" => ">=",
                    "lt" => "<",
                    _ => "<=",
                };
                format!("{field} {op} {}", literal(&f.value, provider)?)
            }
            _ => return Err("The AI requested an unsupported filter.".into()),
        };
        predicates.push(predicate);
    }
    let mut sql = format!(
        "SELECT {}{} FROM {} t{}{}",
        if provider == "sqlserver" {
            format!("TOP ({}) ", plan.limit)
        } else {
            String::new()
        },
        expressions.join(", "),
        table_name(base, provider),
        plan.from,
        joins
    );
    if !predicates.is_empty() {
        sql.push_str(&format!(" WHERE {}", predicates.join(" AND ")));
    }
    if aggregated && !groups.is_empty() {
        sql.push_str(&format!(" GROUP BY {}", groups.join(", ")));
    }
    if !plan.order.is_empty() {
        let mut order = Vec::new();
        for o in &plan.order {
            if o.column >= plan.columns.len() {
                return Err("Invalid sort field.".into());
            }
            order.push(format!(
                "c{} {}",
                o.column,
                if o.descending { "DESC" } else { "ASC" }
            ));
        }
        sql.push_str(&format!(" ORDER BY {}", order.join(", ")));
    }
    if provider != "sqlserver" {
        sql.push_str(&format!(" LIMIT {}", plan.limit));
    }
    Ok(sql)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;
    pub(crate) fn fixture() -> Run {
        serde_json::from_value(json!({"id":"run-a","workspaceId":"workspace-a","database":"demo","provider":"postgres","status":"partial","scanComplete":true,"current":null,"error":null,"destinationId":null,"location":null,
        "entities":[
          {"schema":"public","name":"invoices","status":"done","fields":[
            {"name":"id","dataType":"int","nullable":false,"primaryKey":true,"comment":null},
            {"name":"party_id","dataType":"int","nullable":false,"primaryKey":false,"comment":null},
            {"name":"total","dataType":"numeric","nullable":false,"primaryKey":false,"comment":null}],
           "relationships":[{"columns":["party_id"],"targetSchema":"public","targetTable":"parties","targetColumns":["id"]}],"notes":[],"analysis":{"mapping":{"summary":"Customer sales invoices"}},"error":null},
          {"schema":"public","name":"parties","status":"done","fields":[
            {"name":"id","dataType":"int","nullable":false,"primaryKey":true,"comment":null},
            {"name":"name","dataType":"text","nullable":false,"primaryKey":false,"comment":null}],"relationships":[],"notes":[],"analysis":{"mapping":{"summary":"Customer accounts"}},"error":null}
        ]})).unwrap()
    }
    fn ranking() -> Plan {
        serde_json::from_value(json!({"from":0,"columns":[{"table":1,"column":"name"},{"table":0,"column":"total","aggregate":"sum"}],"joins":[{"table":0,"relationship":0}],"order":[{"column":1,"descending":true}],"limit":5})).unwrap()
    }
    #[test]
    fn generates_and_executes_top_customers_using_declared_join() {
        let sql = compile(&ranking(), &fixture(), &[0, 1]).unwrap();
        let connection = rusqlite::Connection::open_in_memory().unwrap();
        connection.execute_batch("ATTACH DATABASE ':memory:' AS public; CREATE TABLE public.invoices(id INTEGER,party_id INTEGER,total INTEGER); CREATE TABLE public.parties(id INTEGER,name TEXT); INSERT INTO public.parties VALUES(1,'Alice'),(2,'Bob'); INSERT INTO public.invoices VALUES(1,1,20),(2,1,30),(3,2,90);").unwrap();
        let result: (String, i64) = connection
            .query_row(&sql, [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(result, ("Bob".into(), 90));
    }
    #[test]
    fn rejects_unknown_fields_and_excluded_tables() {
        let mut plan = ranking();
        plan.columns[0].column = "name; DROP TABLE parties".into();
        assert!(compile(&plan, &fixture(), &[0, 1]).is_err());
        let mut run = fixture();
        run.entities[1].excluded = true;
        assert!(compile(&ranking(), &run, &[0, 1]).is_err());
        assert!(compile(&ranking(), &fixture(), &[0]).is_err());
    }
    #[test]
    fn rejects_disconnected_joins_and_aggregate_fanout() {
        let mut plan = ranking();
        plan.joins.clear();
        assert!(compile(&plan, &fixture(), &[0, 1]).is_err());
        let mut plan = ranking();
        plan.from = 1;
        assert!(compile(&plan, &fixture(), &[0, 1])
            .unwrap_err()
            .contains("count the same record"));
    }
    #[test]
    fn escapes_filter_values_and_rejects_non_scalar_values() {
        assert_eq!(
            literal(&json!("x'; DROP TABLE t; --"), "postgres").unwrap(),
            "E'x''; DROP TABLE t; --'"
        );
        assert_eq!(
            literal(&json!("O'Reilly"), "sqlserver").unwrap(),
            "N'O''Reilly'"
        );
        assert!(literal(&json!({"$where":"anything"}), "postgres").is_err());
        assert!(literal(&json!("a\u{0000}b"), "postgres").is_err());
    }
    #[test]
    fn sqlserver_uses_top_and_quoted_identifiers() {
        let mut run = fixture();
        run.provider = "sqlserver".into();
        let sql = compile(&ranking(), &run, &[0, 1]).unwrap();
        assert!(sql.starts_with("SELECT TOP (5)"));
        assert!(sql.contains("[public].[invoices]"));
        assert!(!sql.contains("LIMIT"));
    }
    #[test]
    fn limits_rows_and_rejects_arbitrary_expressions() {
        let mut plan = ranking();
        plan.limit = 201;
        assert!(compile(&plan, &fixture(), &[0, 1]).is_err());
        plan.limit = 5;
        plan.columns[1].aggregate = Some("pg_sleep".into());
        assert!(compile(&plan, &fixture(), &[0, 1]).is_err());
    }
}
