"""Copy PG execution checkpoints into a NEW SQLite file through official savers.

Run while application writes are stopped. Existing output is refused.
"""
import argparse
import os
from pathlib import Path
import sqlite3

from langgraph.checkpoint.postgres import PostgresSaver
from langgraph.checkpoint.sqlite import SqliteSaver
from psycopg import Connection
from psycopg.rows import dict_row


def export(target_path):
    path = Path(target_path)
    with path.open('xb'):
        pass
    count = 0
    try:
        with Connection.connect(os.environ['PRESALES_DATABASE_URL'], autocommit=True,
                                prepare_threshold=0, row_factory=dict_row) as connection:
            source = PostgresSaver(connection)
            with sqlite3.connect(path, check_same_thread=False) as destination:
                target = SqliteSaver(destination)
                target.setup()
                for saved in reversed(list(source.list(None))):
                    cfg = saved.config['configurable']
                    config = {'configurable': {
                        'thread_id': cfg['thread_id'],
                        'checkpoint_ns': cfg.get('checkpoint_ns', ''),
                    }}
                    parent = (saved.parent_config or {}).get('configurable', {}).get('checkpoint_id')
                    if parent:
                        config['configurable']['checkpoint_id'] = parent
                    copied_config = target.put(config, saved.checkpoint, saved.metadata,
                                               saved.checkpoint.get('channel_versions', {}))
                    writes_by_task = {}
                    for task, channel, value in saved.pending_writes or []:
                        writes_by_task.setdefault(task, []).append((channel, value))
                    for task, writes in writes_by_task.items():
                        target.put_writes(copied_config, writes, task)
                    copied = target.get_tuple(saved.config)
                    if (copied.checkpoint != saved.checkpoint or copied.metadata != saved.metadata
                            or copied.parent_config != saved.parent_config
                            or sorted(copied.pending_writes, key=repr) != sorted(saved.pending_writes, key=repr)):
                        raise ValueError('Execution checkpoint comparison failed')
                    count += 1
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return count


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--target', required=True)
    args = parser.parse_args()
    print({'checkpoints_and_pending_writes_compared': export(args.target)})
