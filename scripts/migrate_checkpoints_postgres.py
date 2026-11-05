"""Copy LangGraph checkpoints through its official saver APIs, including pending writes."""
import argparse
import copy
import hashlib
import os
import sqlite3
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg import Connection
from psycopg.rows import dict_row


def migrate(path):
    count=0
    with sqlite3.connect(path,check_same_thread=False) as source_connection:
        source=SqliteSaver(source_connection)
        with Connection.connect(os.environ['PRESALES_DATABASE_URL'],autocommit=True,prepare_threshold=0,row_factory=dict_row) as target_connection:
            target=PostgresSaver(target_connection)
            target.setup()
            versions={}
            for saved in reversed(list(source.list(None))):
                if target.get_tuple(saved.config):
                    raise ValueError('Target checkpoint exists; overwrite refused')
                cfg=saved.config['configurable']
                parent=(saved.parent_config or {}).get('configurable',{}).get('checkpoint_id')
                config={'configurable':{'thread_id':cfg['thread_id'],'checkpoint_ns':cfg.get('checkpoint_ns','')}}
                if parent:config['configurable']['checkpoint_id']=parent
                # SQLite embeds values in each checkpoint. PG stores them by channel
                # version; old snapshots may have mutated a value without bumping its
                # version. Give each distinct value an immutable migration version.
                checkpoint=copy.deepcopy(saved.checkpoint)
                scope=(cfg['thread_id'],cfg.get('checkpoint_ns',''))
                current={}
                for channel,version in checkpoint.get('channel_versions',{}).items():
                    value=checkpoint.get('channel_values',{}).get(channel)
                    typed=source.serde.dumps_typed(value)
                    digest=hashlib.sha256(typed[0].encode()+typed[1]).hexdigest()
                    mapped=str(version)+'.migrated.'+digest
                    current[channel]=(version,mapped)
                    versions[(*scope,channel,str(version))]=mapped
                    checkpoint['channel_versions'][channel]=mapped
                for seen in checkpoint.get('versions_seen',{}).values():
                    for channel,version in list(seen.items()):
                        seen[channel]=versions.get((*scope,channel,str(version)),str(version))
                result=target.put(config,checkpoint,saved.metadata,checkpoint.get('channel_versions',{}))
                by_task={}
                for task,channel,value in saved.pending_writes or []:
                    by_task.setdefault(task,[]).append((channel,value))
                for task,writes in by_task.items():target.put_writes(result,writes,task)
                copied=target.get_tuple(saved.config)
                if copied.checkpoint!=checkpoint or copied.metadata!=saved.metadata:
                    raise ValueError('Checkpoint content comparison failed')
                if sorted(copied.pending_writes or [],key=repr)!=sorted(saved.pending_writes or [],key=repr):
                    raise ValueError('Pending writes comparison failed')
                count+=1
    return count


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--source',required=True)
    args=parser.parse_args();print({'checkpoints_compared':migrate(args.source)})
