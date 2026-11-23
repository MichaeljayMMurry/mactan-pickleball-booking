PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS venue (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  location TEXT NOT NULL,
  contact TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS courts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('all','custom','closed')),
  opens INTEGER NOT NULL CHECK (opens BETWEEN 0 AND 1439),
  closes INTEGER NOT NULL CHECK (closes BETWEEN 1 AND 1440),
  weekday INTEGER NOT NULL CHECK (weekday >= 0),
  weekend INTEGER NOT NULL CHECK (weekend >= 0)
);
CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  name TEXT NOT NULL,
  stock INTEGER NOT NULL CHECK (stock >= 0),
  rate INTEGER NOT NULL CHECK (rate >= 0)
);
CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending','Confirmed','Declined','Cancelled')),
  quantity INTEGER NOT NULL CHECK (quantity >= 0),
  equipment_rate INTEGER NOT NULL CHECK (equipment_rate >= 0),
  total INTEGER NOT NULL CHECK (total >= 0),
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS booking_dates ON bookings(date, status);
CREATE TABLE IF NOT EXISTS booking_slots (
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  court_id INTEGER NOT NULL REFERENCES courts(id),
  start INTEGER NOT NULL CHECK (start BETWEEN 0 AND 1380 AND start % 60 = 0),
  rate INTEGER NOT NULL CHECK (rate >= 0),
  PRIMARY KEY (booking_id, court_id, start)
);
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('Open Play','Beginner Clinic','Private Lesson')),
  title TEXT NOT NULL,
  court_id INTEGER NOT NULL REFERENCES courts(id),
  start INTEGER NOT NULL CHECK (start BETWEEN 0 AND 1439),
  end INTEGER NOT NULL CHECK (end BETWEEN 1 AND 1440 AND end > start),
  skill TEXT NOT NULL CHECK (skill IN ('Beginner','Intermediate','Advanced')),
  fee INTEGER NOT NULL CHECK (fee >= 0),
  capacity INTEGER NOT NULL CHECK (capacity > 0 AND (type != 'Private Lesson' OR capacity = 1)),
  coach TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS session_dates ON sessions(date, court_id);
CREATE TABLE IF NOT EXISTS registrations (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  session_id INTEGER NOT NULL REFERENCES sessions(id),
  name TEXT NOT NULL,
  mobile TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending','Confirmed','Checked in','Waitlisted','Declined','Released'))
);
CREATE INDEX IF NOT EXISTS registration_capacity ON registrations(session_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS one_active_registration ON registrations(session_id, mobile)
  WHERE status IN ('Pending','Confirmed','Checked in','Waitlisted');
CREATE TABLE IF NOT EXISTS blocks (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  court_id INTEGER NOT NULL REFERENCES courts(id),
  start INTEGER NOT NULL CHECK (start BETWEEN 0 AND 1439),
  end INTEGER NOT NULL CHECK (end BETWEEN 1 AND 1440 AND end > start),
  reason TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS block_dates ON blocks(date, court_id);
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  username TEXT NOT NULL,
  salt TEXT NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_sessions (
  token_hash TEXT PRIMARY KEY,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reschedule_proposals (
  id INTEGER PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id),
  actor TEXT NOT NULL CHECK (actor IN ('Staff','Player')),
  status TEXT NOT NULL CHECK (status IN ('Pending','Accepted','Declined','Superseded')),
  note TEXT NOT NULL,
  date TEXT NOT NULL,
  slots TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_reschedule ON reschedule_proposals(booking_id) WHERE status='Pending';

CREATE TABLE IF NOT EXISTS booking_activity (
  id INTEGER PRIMARY KEY,
  reference TEXT NOT NULL,
  event TEXT NOT NULL,
  actor TEXT NOT NULL CHECK (actor IN ('Staff','Player')),
  note TEXT NOT NULL,
  created INTEGER NOT NULL,
  previous TEXT,
  proposed TEXT
);
CREATE INDEX IF NOT EXISTS activity_reference_time ON booking_activity(reference, id DESC);
CREATE INDEX IF NOT EXISTS activity_day ON booking_activity(created DESC, id DESC);

CREATE TABLE IF NOT EXISTS app_secrets (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  watch_key TEXT NOT NULL
);
