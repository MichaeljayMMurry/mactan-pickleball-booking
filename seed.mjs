import { randomBytes, scryptSync } from 'node:crypto';

export const zone = 'Asia/Manila';
const dateFormat = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
export const today = () => dateFormat.format(new Date());

export function seedWatchKey(db) {
  if (!db.prepare('SELECT 1 FROM app_secrets WHERE id=1').get()) {
    db.prepare('INSERT INTO app_secrets (id,watch_key) VALUES (1,?)').run(randomBytes(32).toString('hex'));
  }
}

export function addDays(date, days) {
  const midnight = new Date(`${date}T00:00:00Z`);
  midnight.setUTCDate(midnight.getUTCDate() + days);
  return midnight.toISOString().slice(0, 10);
}

export function seedDemo(db) {
  if (db.prepare('SELECT 1 FROM venue').get()) return;
  db.exec(`INSERT INTO venue VALUES (1, 'Mactan Pickleball Club', 'Lapu-Lapu City, Cebu', 'm.me/mactanpickleballclub');
    INSERT INTO courts VALUES (1, 'Court 1', 'all', 0, 1440, 400, 400),
      (2, 'Court 2', 'all', 0, 1440, 400, 500),
      (3, 'Court 3', 'all', 0, 1440, 450, 550),
      (4, 'Court 4', 'all', 0, 1440, 400, 500);
    INSERT INTO equipment VALUES (1, 'Rental paddle', 6, 80);`);
  const insert = db.prepare('INSERT INTO sessions (date,type,title,court_id,start,end,skill,fee,capacity,coach) VALUES (?,?,?,?,?,?,?,?,?,?)');
  const demoDate = addDays(today(), 1);
  insert.run(demoDate, 'Open Play', 'Beginner rally', 1, 1080, 1200, 'Beginner', 250, 8, '');
  insert.run(demoDate, 'Open Play', 'Evening doubles', 2, 1140, 1260, 'Intermediate', 300, 8, '');
  insert.run(demoDate, 'Open Play', 'Competitive doubles', 3, 1140, 1260, 'Advanced', 350, 8, '');
  insert.run(demoDate, 'Beginner Clinic', 'Pickleball fundamentals', 3, 540, 600, 'Beginner', 450, 6, 'Coach Alex');
  insert.run(demoDate, 'Private Lesson', 'One-on-one coaching', 4, 960, 1020, 'Beginner', 1000, 1, 'Coach Sam');
}

export function seedStaff(db, username, password) {
  if (!password && db.prepare('SELECT 1 FROM staff').get()) return null;
  const chosen = password || randomBytes(12).toString('base64url');
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(chosen, salt, 64).toString('hex');
  db.prepare(`INSERT INTO staff VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET
    username=excluded.username,salt=excluded.salt,password_hash=excluded.password_hash`).run(username, salt, hash);
  if (password) db.exec('DELETE FROM staff_sessions');
  return password ? null : chosen;
}
