"""Migration-specific semantics that must survive the backend change."""
import os
import tempfile
import unittest
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from database import Row, parameters, connect, database_url, postgres_enabled


class ParameterTests(unittest.TestCase):
    def test_literals_and_like_escape_keep_parameter_boundaries(self):
        text="SELECT rowid, '?' FROM demo WHERE value LIKE ? ESCAPE '\\' OR value LIKE ?"
        self.assertEqual(parameters(text),"SELECT ctid, '?' FROM demo WHERE value LIKE %s ESCAPE '\\' OR value LIKE %s")
        row=Row(a=1,b='value')
        self.assertEqual(tuple(row),(1,'value'))
        self.assertEqual(dict(row),{'a':1,'b':'value'})
        self.assertEqual(row[1],'value')


@unittest.skipUnless(postgres_enabled(),'requires the isolated PostgreSQL test backend')
class PostgresTests(unittest.TestCase):
    def test_connection_pool_preserves_explicit_schema(self):
        import psycopg,uuid
        from psycopg.conninfo import make_conninfo
        from unittest.mock import patch
        url=database_url();schema='pool_scope_'+uuid.uuid4().hex
        with psycopg.connect(url) as c:c.execute('CREATE SCHEMA '+schema)
        try:
            with patch.dict(os.environ,{'PRESALES_TEST_DATABASE_URL':make_conninfo(url,options='-c search_path='+schema),'PRESALES_TEST_SCHEMA':''}):
                with connect('unused') as c:self.assertEqual(c.execute('SELECT current_schema()').fetchone()[0],schema)
        finally:
            with psycopg.connect(url) as c:c.execute('DROP SCHEMA '+schema)

    def test_pool_replaces_a_terminated_idle_connection(self):
        import psycopg
        with connect('unused') as c:pid=c.execute('SELECT pg_backend_pid()').fetchone()[0]
        with psycopg.connect(database_url()) as c:c.execute('SELECT pg_terminate_backend(%s)',(pid,))
        with connect('unused') as c:self.assertEqual(c.execute('SELECT 1').fetchone()[0],1)

    def test_rollback_upsert_and_cross_connection_critical_section(self):
        with connect('unused') as c:
            c.execute('DROP TABLE IF EXISTS migration_atomic CASCADE')
            c.execute('CREATE TABLE migration_atomic(id TEXT PRIMARY KEY,value INTEGER NOT NULL)')
            c.execute("INSERT INTO migration_atomic VALUES ('same',0)")
        with self.assertRaises(RuntimeError):
            with connect('unused') as c:
                c.execute("UPDATE migration_atomic SET value=999 WHERE id='same'")
                raise RuntimeError('rollback fixture')
        with connect('unused') as c:
            self.assertEqual(c.execute('SELECT value FROM migration_atomic').fetchone()[0],0)
            c.execute("INSERT OR IGNORE INTO migration_atomic VALUES ('same',9)")
            c.execute("INSERT OR REPLACE INTO migration_atomic VALUES ('same',2)")
            self.assertEqual(c.execute('SELECT value FROM migration_atomic').fetchone()[0],2)
        def increment(_):
            with connect('unused') as c:
                c.execute('BEGIN IMMEDIATE')
                value=c.execute('SELECT value FROM migration_atomic').fetchone()[0]
                c.execute('UPDATE migration_atomic SET value=?',(value+1,))
        with ThreadPoolExecutor(max_workers=20) as workers:
            list(workers.map(increment,range(20)))
        with connect('unused') as c:
            self.assertEqual(c.execute('SELECT value FROM migration_atomic').fetchone()[0],22)

    def test_official_graph_saver_restores_pause_and_prevents_double_execution(self):
        import uuid
        from agent_runtime import Runtime
        from fastapi import HTTPException
        with tempfile.TemporaryDirectory(dir=os.getenv('PRESALES_TEST_TMP')) as directory:
            runtime=Runtime(lambda:connect('unused'),Path(directory))
            recipe={'synthetic':True}
            turn='database-test-'+uuid.uuid4().hex
            values=list(runtime.execute('SYNTHETIC','F7','pm',turn,recipe,lambda:iter(['data: {"type":"delta","text":"synthetic"}\n\n']),'confirm_parameters'))
            self.assertTrue(any('waiting' in value for value in values))
            with connect('unused') as c:
                identifier=c.execute('SELECT id FROM runtime_runs WHERE turn_id=?',(turn,)).fetchone()[0]
            another=Runtime(lambda:connect('unused'),Path(directory))
            with another.graph() as graph:
                self.assertEqual(graph.get_state({'configurable':{'thread_id':identifier}}).next,('approval',))
            with runtime.locked(identifier):
                with self.assertRaises(HTTPException) as caught:
                    with another.locked(identifier):
                        self.fail('Second executor acquired the same run')
                self.assertEqual(caught.exception.status_code,409)
