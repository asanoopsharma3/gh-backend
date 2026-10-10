const LEGACY_DOC_TABLES = [
  "users",
  "quizzes",
  "questions",
  "payments",
  "msisdnlogs",
  "mtnpaymentcallbacks",
  "mtnpayments",
  "dailyquizattempts",
  "sdp_callbacks",
  "sdplog",
  "cgwcallbacklogs",
  "cgwcallbacks",
  "ghanacallbacklogs",
  "ghsuperwinings",
];

const TABLES = [
  "users",
  "quizzes",
  "quiz_questions",
  "user_quiz_history",
  "questions",
  "payments",
  "msisdn_logs",
  "mtn_payment_callbacks",
  "mtn_payments",
  "daily_quiz_attempts",
  "sdp_callbacks",
  "sdp_logs",
  "cgw_callback_logs",
  "cgw_callbacks",
  "ghana_callback_logs",
];

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    phone VARCHAR(32),
    otp TEXT,
    otp_expiry TIMESTAMP,
    last_otp_sent TIMESTAMP,
    is_phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
    verify_attempts INTEGER NOT NULL DEFAULT 0,
    is_attempt_quiz BOOLEAN NOT NULL DEFAULT FALSE,
    current_szl_assigned INTEGER NOT NULL DEFAULT 0,
    subscription_status VARCHAR(20) NOT NULL DEFAULT 'inactive',
    questions_played_today INTEGER NOT NULL DEFAULT 0,
    subscription_start_time TIMESTAMP,
    next_play_time TIMESTAMP,
    quiz_id BIGINT,
    current_question_index INTEGER NOT NULL DEFAULT 0,
    total_points INTEGER NOT NULL DEFAULT 0,
    total_amount_spent NUMERIC(12, 2) NOT NULL DEFAULT 0,
    first_time_quiz BOOLEAN NOT NULL DEFAULT TRUE,
    total_time_taken INTEGER NOT NULL DEFAULT 0,
    name VARCHAR(150),
    email VARCHAR(150),
    password TEXT,
    role VARCHAR(30) DEFAULT 'user',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uidx ON users (phone) WHERE COALESCE(phone, '') <> ''`,
  `CREATE UNIQUE INDEX IF NOT EXISTS users_email_uidx ON users (email) WHERE COALESCE(email, '') <> ''`,
  `CREATE INDEX IF NOT EXISTS users_subscription_status_idx ON users (subscription_status)`,
  `CREATE INDEX IF NOT EXISTS users_created_at_idx ON users (created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS quizzes (
    id BIGSERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS quizzes_created_at_idx ON quizzes (created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS quiz_questions (
    id BIGSERIAL PRIMARY KEY,
    quiz_id BIGINT NOT NULL REFERENCES quizzes(id) ON DELETE CASCADE,
    position INTEGER NOT NULL DEFAULT 0,
    q TEXT NOT NULL,
    options TEXT[] NOT NULL DEFAULT '{}',
    correct_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS quiz_questions_quiz_id_idx ON quiz_questions (quiz_id, position)`,

  `CREATE TABLE IF NOT EXISTS user_quiz_history (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    quiz_id BIGINT REFERENCES quizzes(id) ON DELETE SET NULL,
    total_questions INTEGER,
    correct INTEGER,
    wrong INTEGER,
    score NUMERIC(12, 2),
    time_taken INTEGER,
    played_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS user_quiz_history_user_id_idx ON user_quiz_history (user_id, played_at DESC)`,

  `CREATE TABLE IF NOT EXISTS questions (
    id BIGSERIAL PRIMARY KEY,
    question TEXT NOT NULL,
    options TEXT[] NOT NULL DEFAULT '{}',
    correct_index INTEGER NOT NULL,
    created_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,

  `CREATE TABLE IF NOT EXISTS payments (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phone VARCHAR(32) NOT NULL,
    reference_id VARCHAR(200) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    currency VARCHAR(10) NOT NULL DEFAULT 'SZL',
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
    reason TEXT,
    payer_message TEXT,
    payee_note TEXT,
    raw_response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS payments_reference_uidx ON payments (reference_id)`,

  `CREATE TABLE IF NOT EXISTS msisdn_logs (
    id BIGSERIAL PRIMARY KEY,
    msisdn VARCHAR(32),
    source VARCHAR(20) NOT NULL DEFAULT 'HE',
    offer_code VARCHAR(50),
    ip VARCHAR(128),
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_msisdn_logs_msisdn ON msisdn_logs (msisdn)`,

  `CREATE TABLE IF NOT EXISTS mtn_payment_callbacks (
    id BIGSERIAL PRIMARY KEY,
    reference_id VARCHAR(200),
    transaction_id VARCHAR(200) NOT NULL,
    status VARCHAR(20),
    result_code VARCHAR(50),
    result_message TEXT,
    phone VARCHAR(32),
    validity_days VARCHAR(20),
    requested_plan VARCHAR(100),
    applied_plan VARCHAR(100),
    charge_amount VARCHAR(50),
    raw_response JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS mtn_payment_callbacks_transaction_uidx ON mtn_payment_callbacks (transaction_id)`,

  `CREATE TABLE IF NOT EXISTS mtn_payments (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    phone VARCHAR(32) NOT NULL,
    subscription_id VARCHAR(100) NOT NULL,
    subscription_name VARCHAR(150),
    reference_id VARCHAR(200),
    status VARCHAR(20) NOT NULL DEFAULT 'SUCCESS',
    user_updated BOOLEAN NOT NULL DEFAULT FALSE,
    raw_response JSONB,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS mtn_payments_phone_idx ON mtn_payments (phone)`,

  `CREATE TABLE IF NOT EXISTS daily_quiz_attempts (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    attempt_date TIMESTAMP NOT NULL DEFAULT NOW(),
    sets_completed INTEGER NOT NULL DEFAULT 0,
    daily_points INTEGER NOT NULL DEFAULT 0,
    daily_time_taken INTEGER NOT NULL DEFAULT 0,
    is_eligible_for_leaderboard BOOLEAN NOT NULL DEFAULT FALSE,
    quiz_id BIGINT REFERENCES quizzes(id) ON DELETE SET NULL,
    current_question_index INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS daily_quiz_attempts_user_date_uidx ON daily_quiz_attempts (user_id, attempt_date)`,

  `CREATE TABLE IF NOT EXISTS sdp_callbacks (
    id BIGSERIAL PRIMARY KEY,
    method VARCHAR(10),
    msisdn VARCHAR(32),
    transaction_id VARCHAR(200),
    offer_code VARCHAR(50),
    status VARCHAR(50),
    operator VARCHAR(50),
    operator_response JSONB,
    callback_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    payload_json JSONB,
    lifecycle VARCHAR(100),
    reason TEXT,
    raw_query JSONB,
    raw_body JSONB,
    headers JSONB,
    ip VARCHAR(128),
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sdp_callbacks_msisdn ON sdp_callbacks (msisdn)`,
  `CREATE INDEX IF NOT EXISTS idx_sdp_callbacks_transaction_id ON sdp_callbacks (transaction_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sdp_callbacks_timestamp ON sdp_callbacks (callback_timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_sdp_callbacks_created_at ON sdp_callbacks (created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS sdp_logs (
    id BIGSERIAL PRIMARY KEY,
    method VARCHAR(10),
    external_service_id VARCHAR(100),
    request_id VARCHAR(200),
    request_timestamp VARCHAR(100),
    channel VARCHAR(50),
    feature_id VARCHAR(50),
    plan_id VARCHAR(50),
    command VARCHAR(50),
    msisdn VARCHAR(32),
    offer_code VARCHAR(50),
    charge_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    subscription_status VARCHAR(50),
    subscriber_life_cycle VARCHAR(100),
    transaction_id VARCHAR(200),
    next_billing_date VARCHAR(50),
    reason TEXT,
    normalized_status VARCHAR(50),
    operator VARCHAR(50),
    callback_timestamp TIMESTAMP NOT NULL DEFAULT NOW(),
    payload_json JSONB,
    raw_query JSONB,
    raw_body JSONB,
    headers JSONB,
    ip VARCHAR(128),
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sdp_logs_request_id ON sdp_logs (request_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sdp_logs_msisdn ON sdp_logs (msisdn)`,
  `CREATE INDEX IF NOT EXISTS idx_sdp_logs_transaction_id ON sdp_logs (transaction_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sdp_logs_timestamp ON sdp_logs (callback_timestamp)`,
  `CREATE INDEX IF NOT EXISTS idx_sdp_logs_created_at ON sdp_logs (created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS cgw_callback_logs (
    id BIGSERIAL PRIMARY KEY,
    type VARCHAR(10) NOT NULL DEFAULT 'CGW',
    method VARCHAR(10),
    msisdn VARCHAR(32),
    offer_code VARCHAR(50),
    status VARCHAR(50),
    lifecycle VARCHAR(100),
    reason TEXT,
    cgid VARCHAR(100),
    raw_query JSONB,
    raw_body JSONB,
    headers JSONB,
    ip VARCHAR(128),
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cgw_callback_logs_msisdn ON cgw_callback_logs (msisdn)`,
  `CREATE INDEX IF NOT EXISTS idx_cgw_callback_logs_created_at ON cgw_callback_logs (created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS cgw_callbacks (
    id BIGSERIAL PRIMARY KEY,
    method VARCHAR(10),
    msisdn VARCHAR(32),
    offer_code VARCHAR(50),
    status VARCHAR(50),
    cgid VARCHAR(100),
    raw_query JSONB,
    raw_body JSONB,
    headers JSONB,
    ip VARCHAR(128),
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_cgw_callbacks_msisdn ON cgw_callbacks (msisdn)`,
  `CREATE INDEX IF NOT EXISTS idx_cgw_callbacks_created_at ON cgw_callbacks (created_at DESC)`,

  `CREATE TABLE IF NOT EXISTS ghana_callback_logs (
    id BIGSERIAL PRIMARY KEY,
    callback_type VARCHAR(10) NOT NULL,
    flow VARCHAR(10) NOT NULL DEFAULT 'UNKNOWN',
    method VARCHAR(10),
    msisdn VARCHAR(32),
    offer_code VARCHAR(50),
    status VARCHAR(50),
    normalized_status VARCHAR(50),
    lifecycle VARCHAR(100),
    reason TEXT,
    cgid VARCHAR(100),
    charging_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    raw_query JSONB,
    raw_body JSONB,
    headers JSONB,
    ip VARCHAR(128),
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  )`,
  `CREATE INDEX IF NOT EXISTS idx_ghana_callback_logs_type ON ghana_callback_logs (callback_type)`,
  `CREATE INDEX IF NOT EXISTS idx_ghana_callback_logs_msisdn ON ghana_callback_logs (msisdn)`,
  `CREATE INDEX IF NOT EXISTS idx_ghana_callback_logs_created_at ON ghana_callback_logs (created_at DESC)`,
];

const dropLegacyDocumentTables = async (db) => {
  for (const table of LEGACY_DOC_TABLES) {
    const legacy = await db.query(
      `SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'doc'`,
      [table]
    );
    if (legacy.rowCount) {
      await db.query(`DROP TABLE IF EXISTS ${table} CASCADE`);
    }
  }
  await db.query("DROP TABLE IF EXISTS ghsuperwinings CASCADE");
};

export async function ensureSchema(db) {
  await dropLegacyDocumentTables(db);
  for (const statement of STATEMENTS) {
    await db.query(statement);
  }
}

export { TABLES };
