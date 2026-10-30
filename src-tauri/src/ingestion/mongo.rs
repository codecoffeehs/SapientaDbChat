use super::models::{Entity, Field};
use mongodb::{
    Database,
    bson::{Bson, Document, doc},
};
use std::{
    collections::{BTreeMap, BTreeSet},
    time::Duration,
};

pub async fn list(database: &Database) -> Result<Vec<Entity>, String> {
    let mut names = database
        .list_collection_names()
        .await
        .map_err(|_| "Could not list collections. Check MongoDB permissions.")?;
    names.sort();
    Ok(names
        .into_iter()
        .filter(|name| !name.starts_with("system."))
        .map(|name| Entity::new(String::new(), name))
        .collect())
}

fn field_types(
    document: &Document,
    prefix: &str,
    depth: usize,
    fields: &mut BTreeMap<String, BTreeSet<String>>,
) -> Result<(), String> {
    if depth > 12 {
        return Err("Document nesting exceeds the supported scan depth (12).".into());
    }
    for (key, value) in document {
        let path = if prefix.is_empty() {
            key.clone()
        } else {
            format!("{prefix}.{key}")
        };
        if path.len() > 512 || fields.len() >= 2048 {
            return Err("This collection exceeds the field metadata limit. Narrow the collection schema before ingestion.".into());
        }
        fields
            .entry(path.clone())
            .or_default()
            .insert(format!("{:?}", value.element_type()));
        match value {
            Bson::Document(child) => field_types(child, &path, depth + 1, fields)?,
            Bson::Array(values) => {
                for item in values.iter().take(16) {
                    let item_path = format!("{path}[]");
                    fields
                        .entry(item_path.clone())
                        .or_default()
                        .insert(format!("{:?}", item.element_type()));
                    if let Bson::Document(child) = item {
                        field_types(child, &item_path, depth + 1, fields)?;
                    }
                }
            }
            _ => {}
        }
    }
    Ok(())
}

pub async fn inspect(database: &Database, entity: &mut Entity) -> Result<(), String> {
    let collection = database.collection::<Document>(&entity.name);
    let present = collection
        .find_one(doc! {})
        .projection(doc! { "_id": 1 })
        .max_time(Duration::from_secs(10))
        .await
        .map_err(|_| "Could not check this collection. Check read permissions and availability.")?;
    entity.presence_checked = true;
    if present.is_none() {
        entity.is_empty = true;
        entity.notes.push("Empty collection: no sampled field structure is available. Only its name is known; field meanings and relationships are unknown.".into());
        entity.status = "empty".into();
        return Ok(());
    }
    let mut cursor = collection
        .find(doc! {})
        .limit(32)
        .batch_size(4)
        .max_time(Duration::from_secs(15))
        .await
        .map_err(|_| "Could not inspect this collection’s document structure.")?;
    let mut types = BTreeMap::new();
    let mut sampled = 0;
    while cursor
        .advance()
        .await
        .map_err(|_| "Could not finish sampling document structure.")?
    {
        let document = cursor
            .deserialize_current()
            .map_err(|_| "Could not read document structure.")?;
        field_types(&document, "", 0, &mut types)?;
        sampled += 1;
    }
    entity.fields = types
        .into_iter()
        .map(|(name, types)| Field {
            primary_key: name == "_id",
            name,
            data_type: types.into_iter().collect::<Vec<_>>().join(" | "),
            nullable: true,
            comment: None,
        })
        .collect();
    entity.notes.push(format!("Inferred from up to {sampled} documents and 16 elements per array, locally. Values are discarded. Rare fields may be missing; nullability and relationships are not proven."));
    entity.status = "data".into();
    Ok(())
}
