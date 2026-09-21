import mysql.connector

def get_db_connection(host, port, user, password, database=None):
    return mysql.connector.connect(
        host=host,
        port=int(port),
        user=user,
        password=password,
        database=database
    )

def fetch_all_databases(host, port, user, password):
    try:
        conn = get_db_connection(host, port, user, password)
        cursor = conn.cursor()
        cursor.execute("SHOW DATABASES;")
        databases = [db[0] for db in cursor.fetchall() if db[0] not in ['information_schema', 'mysql', 'performance_schema', 'sys']]
        conn.close()
        return {"status": "success", "databases": databases}
    except Exception as e:
        return {"status": "error", "message": str(e)}

def fetch_db_tables(host, port, user, password, database):
    try:
        conn = get_db_connection(host, port, user, password, database)
        cursor = conn.cursor()
        cursor.execute("SHOW TABLES;")
        tables = [tbl[0] for tbl in cursor.fetchall()]
        conn.close()
        return {"status": "success", "tables": tables}
    except Exception as e:
        return {"status": "error", "message": str(e)}