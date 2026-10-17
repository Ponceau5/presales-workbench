from fastapi import Depends

def install(app,db,actor,now):
    with db() as c:c.execute('CREATE TABLE IF NOT EXISTS user_guide_state(user_id TEXT PRIMARY KEY,seen_at TEXT NOT NULL)')
    @app.get('/api/me/guide')
    def status(user=Depends(actor)):
        with db() as c:seen=c.execute('SELECT 1 FROM user_guide_state WHERE user_id=?',(str(user),)).fetchone()
        return {'seen':bool(seen)}
    @app.post('/api/me/guide/seen')
    def seen(user=Depends(actor)):
        with db() as c:c.execute('INSERT OR IGNORE INTO user_guide_state VALUES (?,?)',(str(user),now()))
        return {'seen':True}
