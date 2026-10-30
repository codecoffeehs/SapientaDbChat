import {
  Database02Icon,
  Leaf01Icon,
  MicrosoftIcon,
} from "@hugeicons/core-free-icons";

export const databases = [
  {
    id: "postgres",
    name: "PostgreSQL",
    label: "The open-source powerhouse",
    description: "Connect your local Postgres instance or a hosted database.",
    type: "Relational",
    icon: Database02Icon,
    color: "text-sky-700 bg-sky-50 dark:text-sky-400 dark:bg-sky-950/40",
    placeholder: "postgresql://user:password@localhost:5432/my_database",
    example: "postgresql://user:password@localhost:5432/my_database?sslmode=prefer",
    help: "Use a postgres:// or postgresql:// URI. Percent-encode special characters in your username and password.",
  },
  {
    id: "sqlserver",
    name: "SQL Server",
    label: "Built for your business",
    description: "Connect to your Microsoft SQL Server database.",
    type: "Relational",
    icon: MicrosoftIcon,
    color: "text-rose-700 bg-rose-50 dark:text-rose-400 dark:bg-rose-950/40",
    placeholder: "Server=tcp:localhost,1433;Database=my_database;User Id=sa;Password=…;",
    example: "Server=tcp:localhost,1433;Database=my_database;User Id=sa;Password=your_password;Encrypt=true;TrustServerCertificate=false;",
    help: "Use an ADO.NET connection string with SQL Server authentication and an explicit host and port. For a local self-signed certificate, you can explicitly set TrustServerCertificate=true.",
  },
  {
    id: "mongodb",
    name: "MongoDB",
    label: "A home for your documents",
    description: "Connect to a MongoDB deployment or your Atlas cluster.",
    type: "Document",
    icon: Leaf01Icon,
    color: "text-emerald-700 bg-emerald-50 dark:text-emerald-400 dark:bg-emerald-950/40",
    placeholder: "mongodb://user:password@localhost:27017/my_database",
    example: "mongodb://user:password@localhost:27017/my_database?authSource=admin",
    help: "Accepts mongodb:// and mongodb+srv:// for Atlas. Include the database name after the host and use authSource if your user belongs to another database.",
  },
] as const;

export type Database = (typeof databases)[number];

