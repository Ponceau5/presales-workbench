# PostgreSQL 迁移与回退

应用继续使用现有 LangChain/LangGraph 执行流程。业务数据库通过 `PRESALES_DATABASE_URL` 选择 PostgreSQL；不设置时使用原 SQLite。Casdoor 的数据库和账号不在本迁移范围内。

## 切换前准备

1. 准备 PostgreSQL 17、pgvector、pg_trgm，安装 server/requirements.txt。
2. 停止新任务，等待运行和正在停止的任务全部结束，停止全部写入进程。
3. 明确当前 SQLite 和 `agent-runtime/checkpoints.sqlite3` 的路径，保留原始文件存储。数据库迁移保留文件路径或 OSS 引用，不复制原件进数据库。
4. 创建空目标数据库。连接信息通过环境传入，避免写进源码或报告。

## 业务数据与检查点迁移

使用 `scripts/migrate_postgres.py --source ... --backup ... --report ...`。脚本先生成一致性 SQLite 快照，目标有表时拒绝导入。导入后按每张表的全部字段比较条数与内容；任一不一致即回滚目标事务并报错。

另运行 `scripts/migrate_checkpoints_postgres.py --source ...`，通过 LangGraph 官方保存器迁移检查点及待处理写入。目标已有同编号检查点时拒绝覆盖。不要仅复制 runtime_runs 而遗漏检查点。

设置 `PRESALES_DATABASE_URL` 后启动隔离 API，执行实际登录、授权、资料更新停用、历史、任务停止重试及成果重复采纳回归。API 启动时初始化官方检查点结构；执行任务时不重复建表。

## 连接与事务

Psycopg 官方连接池默认最多20条，等待连接最多10秒；SQL语句最多30秒、锁等待最多10秒。它们约束数据库操作，原模型等待与调用次数规则保持原值。耗时统计由管理员接口 `/api/access/database/metrics` 提供，包含查询写入耗时、连接池和当前锁等待，不返回连接凭据或SQL正文。

旧代码的短写入临界区使用 PostgreSQL 事务锁，保留原有版本递增与重复请求保护。LangGraph 同一运行用 PostgreSQL 运行锁防止双执行。单实例结果尚不代表跨机器任务归属恢复已验证。

## 备份与恢复

PG 使用原生 `pg_dump -Fc`。在新库用 `pg_restore --exit-on-error` 恢复，随后逐表比较并实际恢复暂停任务。定时备份脚本 server/backup_state.py 根据后端选择原生工具；部署时必须保证 pg_dump 在PATH中或设置PRESALES_PG_DUMP。

## 回退

切换前可直接撤销环境变量，继续使用保留的SQLite原库。PG开始产生新写入后，不应直接退回旧快照。

先停止写入，再运行 `scripts/rollback_postgres.py --schema-snapshot ... --target ... --report ...`，把PG当前业务记录导出到一个新的SQLite文件，逐表比较并检查外键。现有文件不被覆盖。向量索引为衍生数据，不导入SQLite。

再运行 `scripts/rollback_checkpoints_sqlite.py --target 新目录/agent-runtime/checkpoints.sqlite3`。它通过官方保存器复制执行记录、父记录和未完成写入，逐条比较；拒绝覆盖已有文件。业务表导出与任务记录导出期间必须保持停止写入。

2026-10-29合成数据演练：66张业务表和13条执行记录核对一致；撤销PG环境变量后，用回退业务库和任务库恢复等待参数确认的任务，确认完成且重复确认无重复执行。真实业务库尚未切换，跨机器部署与云上备份仍需正式环境验收。

## 向量检索状态

按2026-10-29用户确认，向量模型与真实向量召回暂缓。已准备pgvector表结构与原检索版本/权限规则，embedding为空、status=pending。没有生成伪向量，也没有把建表写成混合检索通过。向量模型确定后再创建与其维度相符的向量索引，并跑业务题集比较。
