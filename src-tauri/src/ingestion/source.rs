use super::models::Entity;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio_util::compat::{Compat, TokioAsyncWriteCompatExt};

pub struct Postgres {
    pub client: tokio_postgres::Client,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Postgres {
    fn drop(&mut self) {
        self.task.abort();
    }
}

pub enum Source {
    Postgres(Postgres),
    SqlServer(tiberius::Client<Compat<TcpStream>>),
    Mongo(mongodb::Database),
}

impl Source {
    pub async fn open(provider: &str, uri: &str) -> Result<Self, String> {
        tokio::time::timeout(Duration::from_secs(25), async {
            match provider {
                "postgres" => {
                    let mut config = uri.parse::<tokio_postgres::Config>().map_err(|_| "Invalid saved PostgreSQL connection.")?;
                    config.connect_timeout(Duration::from_secs(10));
                    let tls = native_tls::TlsConnector::new().map_err(|_| "Could not initialize TLS.")?;
                    let (client, connection) = config.connect(postgres_native_tls::MakeTlsConnector::new(tls)).await
                        .map_err(|_| "Could not connect to PostgreSQL. Check network access and credentials.")?;
                    let task = tokio::spawn(async move { let _ = connection.await; });
                    let source = Postgres { client, task };
                    source.client.batch_execute("SET default_transaction_read_only = on; SET statement_timeout = '15s'; SET lock_timeout = '3s';").await
                        .map_err(|_| "Could not configure the read-only schema scan.")?;
                    Ok(Self::Postgres(source))
                }
                "sqlserver" => {
                    let config = tiberius::Config::from_ado_string(uri).map_err(|_| "Invalid saved SQL Server connection.")?;
                    let tcp = TcpStream::connect(config.get_addr()).await.map_err(|_| "Could not reach SQL Server.")?;
                    tcp.set_nodelay(true).map_err(|_| "Could not configure SQL Server connection.")?;
                    let mut client = tiberius::Client::connect(config, tcp.compat_write()).await
                        .map_err(|_| "SQL Server connection failed. Check credentials and TLS settings.")?;
                    client.simple_query("SET LOCK_TIMEOUT 3000;").await.map_err(|_| "Could not configure SQL Server scan.")?
                        .into_results().await.map_err(|_| "Could not configure SQL Server scan.")?;
                    Ok(Self::SqlServer(client))
                }
                "mongodb" => {
                    let (client, database) = crate::database::mongodb::open(uri).await?;
                    Ok(Self::Mongo(client.database(&database)))
                }
                _ => Err("Unsupported database provider.".into()),
            }
        }).await.map_err(|_| "The database connection timed out.".to_string())?
    }

    pub async fn list(&mut self) -> Result<Vec<Entity>, String> {
        match self {
            Self::Postgres(db) => super::postgres::list(&db.client).await,
            Self::SqlServer(db) => super::sql_server::list(db).await,
            Self::Mongo(db) => super::mongo::list(db).await,
        }
    }

    pub async fn metadata(&mut self, entities: &mut [Entity]) -> Result<(), String> {
        match self {
            Self::Postgres(db) => super::postgres::metadata(&db.client, entities).await,
            Self::SqlServer(db) => super::sql_server::metadata(db, entities).await,
            Self::Mongo(_) => Err("SQL metadata is not supported for MongoDB.".into()),
        }
    }
}
