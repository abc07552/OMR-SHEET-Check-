-- Runs only for a NEW PostgreSQL data volume. The API is never a PostgreSQL
-- superuser. Database credentials are read from the container environment,
-- not interpolated into a shell command or passed as psql arguments.
\getenv omr_password OMR_DB_PASSWORD
SELECT format('CREATE ROLE omr LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD %L', :'omr_password') \gexec
ALTER DATABASE omr OWNER TO omr;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO omr;
