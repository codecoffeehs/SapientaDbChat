pub(crate) mod mongodb;
mod postgres;
mod sql_server;

use serde::Deserialize;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DatabaseKind {
    Postgres,
    SqlServer,
    Mongodb,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionRequest {
    pub database: DatabaseKind,
    pub connection_string: String,
}

pub struct ConnectionCheck {
    pub database: String,
    pub elapsed_ms: u64,
}

pub async fn verify_connection(request: &ConnectionRequest) -> Result<ConnectionCheck, String> {
    let connection_string = request.connection_string.trim();
    if connection_string.is_empty() {
        return Err("Enter a connection string to continue.".into());
    }
    if connection_string.len() > 16_384 {
        return Err("The connection string is too long. Use fewer than 16,384 bytes.".into());
    }

    let started = Instant::now();
    // Keep both connection setup and the query within one deadline. No credentials are logged.
    let database = tokio::time::timeout(Duration::from_secs(20), async {
        match request.database {
            DatabaseKind::Postgres => postgres::connect(connection_string).await,
            DatabaseKind::SqlServer => sql_server::connect(connection_string).await,
            DatabaseKind::Mongodb => mongodb::connect(connection_string).await,
        }
    })
    .await
    .map_err(|_| "The connection timed out after 20 seconds. Check the host, port, firewall, and VPN, then try again.".to_string())??;

    Ok(ConnectionCheck {
        database,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}
