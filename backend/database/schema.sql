-- Smart Hospital Queue Management System : PostgreSQL schema
-- GENERATED from database/models.py -> regenerate with: python -m database.init_db --sql > database/schema.sql

CREATE TABLE hospitals (
	id SERIAL NOT NULL, 
	name VARCHAR(150) NOT NULL, 
	address VARCHAR(255), 
	city VARCHAR(80) NOT NULL, 
	state VARCHAR(80), 
	postal_code VARCHAR(12), 
	phone VARCHAR(20), 
	email VARCHAR(120), 
	opens_at TIME WITHOUT TIME ZONE, 
	closes_at TIME WITHOUT TIME ZONE, 
	is_active BOOLEAN DEFAULT true NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_hospitals PRIMARY KEY (id), 
	CONSTRAINT uq_hospitals_name_city UNIQUE (name, city)
);

CREATE INDEX ix_hospitals_city ON hospitals (city);

CREATE TABLE patients (
	id SERIAL NOT NULL, 
	full_name VARCHAR(120) NOT NULL, 
	phone VARCHAR(20) NOT NULL, 
	email VARCHAR(120), 
	password_hash VARCHAR(255), 
	date_of_birth DATE, 
	gender VARCHAR(20), 
	is_active BOOLEAN DEFAULT true NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_patients PRIMARY KEY (id), 
	CONSTRAINT uq_patients_phone UNIQUE (phone), 
	CONSTRAINT uq_patients_email UNIQUE (email), 
	CONSTRAINT ck_patients_gender CHECK (gender IN ('male', 'female', 'other'))
);


CREATE TABLE departments (
	id SERIAL NOT NULL, 
	hospital_id INTEGER NOT NULL, 
	name VARCHAR(100) NOT NULL, 
	code VARCHAR(6) NOT NULL, 
	description TEXT, 
	avg_consult_minutes INTEGER DEFAULT '10' NOT NULL, 
	max_daily_tokens INTEGER, 
	report_grace_minutes INTEGER DEFAULT '20' NOT NULL, 
	is_active BOOLEAN DEFAULT true NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_departments PRIMARY KEY (id), 
	CONSTRAINT uq_departments_hospital_name UNIQUE (hospital_id, name), 
	CONSTRAINT uq_departments_hospital_code UNIQUE (hospital_id, code), 
	CONSTRAINT ck_departments_avg_consult_positive CHECK (avg_consult_minutes > 0), 
	CONSTRAINT fk_departments_hospital_id_hospitals FOREIGN KEY(hospital_id) REFERENCES hospitals (id) ON DELETE RESTRICT
);

CREATE INDEX ix_departments_hospital_id ON departments (hospital_id);

CREATE TABLE staff_users (
	id SERIAL NOT NULL, 
	hospital_id INTEGER, 
	full_name VARCHAR(120) NOT NULL, 
	email VARCHAR(120) NOT NULL, 
	password_hash VARCHAR(255) NOT NULL, 
	role VARCHAR(20) NOT NULL, 
	is_active BOOLEAN DEFAULT true NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_staff_users PRIMARY KEY (id), 
	CONSTRAINT fk_staff_users_hospital_id_hospitals FOREIGN KEY(hospital_id) REFERENCES hospitals (id) ON DELETE RESTRICT, 
	CONSTRAINT uq_staff_users_email UNIQUE (email), 
	CONSTRAINT ck_staff_users_staff_role CHECK (role IN ('super_admin', 'hospital_admin', 'receptionist', 'doctor'))
);

CREATE INDEX ix_staff_users_hospital_id ON staff_users (hospital_id);

CREATE TABLE alerts (
	id SERIAL NOT NULL, 
	hospital_id INTEGER NOT NULL, 
	department_id INTEGER, 
	alert_type VARCHAR(20) NOT NULL, 
	severity VARCHAR(20) NOT NULL, 
	message TEXT NOT NULL, 
	is_resolved BOOLEAN DEFAULT false NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	resolved_at TIMESTAMP WITH TIME ZONE, 
	resolved_by_id INTEGER, 
	CONSTRAINT pk_alerts PRIMARY KEY (id), 
	CONSTRAINT fk_alerts_hospital_id_hospitals FOREIGN KEY(hospital_id) REFERENCES hospitals (id) ON DELETE RESTRICT, 
	CONSTRAINT fk_alerts_department_id_departments FOREIGN KEY(department_id) REFERENCES departments (id) ON DELETE SET NULL, 
	CONSTRAINT ck_alerts_alert_type CHECK (alert_type IN ('congestion', 'long_wait', 'doctor_unavailable', 'emergency_token', 'system')), 
	CONSTRAINT ck_alerts_alert_severity CHECK (severity IN ('info', 'warning', 'critical')), 
	CONSTRAINT fk_alerts_resolved_by_id_staff_users FOREIGN KEY(resolved_by_id) REFERENCES staff_users (id) ON DELETE SET NULL
);

CREATE INDEX ix_alerts_hospital_id ON alerts (hospital_id);
CREATE INDEX ix_alerts_hospital_open ON alerts (hospital_id, is_resolved, created_at);

CREATE TABLE doctors (
	id SERIAL NOT NULL, 
	department_id INTEGER NOT NULL, 
	full_name VARCHAR(120) NOT NULL, 
	specialization VARCHAR(120), 
	qualification VARCHAR(120), 
	phone VARCHAR(20), 
	email VARCHAR(120), 
	status VARCHAR(20) DEFAULT 'off_duty' NOT NULL, 
	shift_start TIME WITHOUT TIME ZONE, 
	shift_end TIME WITHOUT TIME ZONE, 
	is_active BOOLEAN DEFAULT true NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_doctors PRIMARY KEY (id), 
	CONSTRAINT fk_doctors_department_id_departments FOREIGN KEY(department_id) REFERENCES departments (id) ON DELETE RESTRICT, 
	CONSTRAINT ck_doctors_doctor_status CHECK (status IN ('available', 'on_break', 'off_duty'))
);

CREATE INDEX ix_doctors_department_id ON doctors (department_id);

CREATE TABLE qr_stations (
	id SERIAL NOT NULL, 
	public_id VARCHAR(32) NOT NULL, 
	hospital_id INTEGER NOT NULL, 
	department_id INTEGER, 
	name VARCHAR(100) NOT NULL, 
	purpose VARCHAR(20) NOT NULL, 
	secret VARCHAR(64) NOT NULL, 
	rotation_seconds INTEGER, 
	is_active BOOLEAN DEFAULT true NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_qr_stations PRIMARY KEY (id), 
	CONSTRAINT uq_qr_stations_hospital_name UNIQUE (hospital_id, name), 
	CONSTRAINT ck_qr_stations_checkin_must_rotate CHECK (purpose <> 'check_in' OR rotation_seconds IS NOT NULL), 
	CONSTRAINT ck_qr_stations_rotation_range CHECK (rotation_seconds IS NULL OR rotation_seconds BETWEEN 10 AND 3600), 
	CONSTRAINT uq_qr_stations_public_id UNIQUE (public_id), 
	CONSTRAINT fk_qr_stations_hospital_id_hospitals FOREIGN KEY(hospital_id) REFERENCES hospitals (id) ON DELETE RESTRICT, 
	CONSTRAINT fk_qr_stations_department_id_departments FOREIGN KEY(department_id) REFERENCES departments (id) ON DELETE RESTRICT, 
	CONSTRAINT ck_qr_stations_qr_purpose CHECK (purpose IN ('check_in', 'walk_in'))
);

CREATE INDEX ix_qr_stations_hospital_id ON qr_stations (hospital_id);

CREATE TABLE queue_snapshots (
	id SERIAL NOT NULL, 
	department_id INTEGER NOT NULL, 
	captured_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	virtual_waiting_count INTEGER NOT NULL, 
	physical_waiting_count INTEGER NOT NULL, 
	in_consultation_count INTEGER NOT NULL, 
	doctors_available INTEGER NOT NULL, 
	avg_physical_wait_minutes FLOAT, 
	CONSTRAINT pk_queue_snapshots PRIMARY KEY (id), 
	CONSTRAINT fk_queue_snapshots_department_id_departments FOREIGN KEY(department_id) REFERENCES departments (id) ON DELETE RESTRICT
);

CREATE INDEX ix_queue_snapshots_dept_time ON queue_snapshots (department_id, captured_at);

CREATE TABLE tokens (
	id SERIAL NOT NULL, 
	public_id VARCHAR(32) NOT NULL, 
	token_number INTEGER NOT NULL, 
	token_date DATE DEFAULT CURRENT_DATE NOT NULL, 
	patient_id INTEGER NOT NULL, 
	department_id INTEGER NOT NULL, 
	doctor_id INTEGER, 
	priority SMALLINT DEFAULT '2' NOT NULL, 
	status VARCHAR(20) DEFAULT 'waiting' NOT NULL, 
	reason TEXT, 
	queue_type VARCHAR(20) DEFAULT 'virtual' NOT NULL, 
	source VARCHAR(20) DEFAULT 'app' NOT NULL, 
	checked_in_at TIMESTAMP WITH TIME ZONE, 
	check_in_method VARCHAR(20), 
	checked_in_by_id INTEGER, 
	qr_station_id INTEGER, 
	issued_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	called_at TIMESTAMP WITH TIME ZONE, 
	consultation_started_at TIMESTAMP WITH TIME ZONE, 
	completed_at TIMESTAMP WITH TIME ZONE, 
	position_at_issue INTEGER, 
	predicted_wait_minutes INTEGER, 
	virtual_queue_length_at_issue INTEGER, 
	physical_queue_length_at_issue INTEGER, 
	physical_queue_length_at_checkin INTEGER, 
	doctors_available_at_issue INTEGER, 
	expected_call_at TIMESTAMP WITH TIME ZONE, 
	report_by_at TIMESTAMP WITH TIME ZONE, 
	report_deadline_at TIMESTAMP WITH TIME ZONE, 
	absence_count INTEGER DEFAULT '0' NOT NULL, 
	CONSTRAINT pk_tokens PRIMARY KEY (id), 
	CONSTRAINT uq_tokens_dept_date_number UNIQUE (department_id, token_date, token_number), 
	CONSTRAINT ck_tokens_priority_valid CHECK (priority IN (0, 1, 2)), 
	CONSTRAINT ck_tokens_number_positive CHECK (token_number > 0), 
	CONSTRAINT ck_tokens_virtual_not_called CHECK (queue_type = 'physical' OR status NOT IN ('called','in_consultation','completed')), 
	CONSTRAINT ck_tokens_physical_has_checkin CHECK (queue_type = 'virtual' OR checked_in_at IS NOT NULL), 
	CONSTRAINT ck_tokens_checkin_fields_together CHECK ((checked_in_at IS NULL AND check_in_method IS NULL) OR (checked_in_at IS NOT NULL AND check_in_method IS NOT NULL)), 
	CONSTRAINT ck_tokens_offline_source_is_physical CHECK (source = 'app' OR queue_type = 'physical'), 
	CONSTRAINT uq_tokens_public_id UNIQUE (public_id), 
	CONSTRAINT fk_tokens_patient_id_patients FOREIGN KEY(patient_id) REFERENCES patients (id) ON DELETE RESTRICT, 
	CONSTRAINT fk_tokens_department_id_departments FOREIGN KEY(department_id) REFERENCES departments (id) ON DELETE RESTRICT, 
	CONSTRAINT fk_tokens_doctor_id_doctors FOREIGN KEY(doctor_id) REFERENCES doctors (id) ON DELETE SET NULL, 
	CONSTRAINT ck_tokens_token_status CHECK (status IN ('waiting', 'called', 'in_consultation', 'completed', 'skipped', 'cancelled', 'no_show')), 
	CONSTRAINT ck_tokens_queue_type CHECK (queue_type IN ('virtual', 'physical')), 
	CONSTRAINT ck_tokens_token_source CHECK (source IN ('app', 'walkin_qr', 'reception')), 
	CONSTRAINT ck_tokens_check_in_method CHECK (check_in_method IN ('dynamic_qr', 'token_qr_scan', 'manual', 'walkin_qr')), 
	CONSTRAINT fk_tokens_checked_in_by_id_staff_users FOREIGN KEY(checked_in_by_id) REFERENCES staff_users (id) ON DELETE SET NULL, 
	CONSTRAINT fk_tokens_qr_station_id_qr_stations FOREIGN KEY(qr_station_id) REFERENCES qr_stations (id) ON DELETE SET NULL
);

CREATE INDEX ix_tokens_doctor_id ON tokens (doctor_id);
CREATE INDEX ix_tokens_patient_id ON tokens (patient_id);
CREATE INDEX ix_tokens_physical_queue ON tokens (department_id, token_date, status, priority, checked_in_at) WHERE queue_type = 'physical';
CREATE INDEX ix_tokens_virtual_queue ON tokens (department_id, token_date, status, priority, issued_at) WHERE queue_type = 'virtual';
CREATE UNIQUE INDEX uq_tokens_one_active_per_patient_dept ON tokens (patient_id, department_id, token_date) WHERE status IN ('waiting','called','in_consultation');

CREATE TABLE predictions (
	id SERIAL NOT NULL, 
	department_id INTEGER NOT NULL, 
	token_id INTEGER, 
	generated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	queue_type VARCHAR(20), 
	horizon_minutes INTEGER, 
	predicted_wait_minutes INTEGER, 
	predicted_queue_length INTEGER, 
	congestion_level VARCHAR(20), 
	confidence FLOAT, 
	model_version VARCHAR(50), 
	CONSTRAINT pk_predictions PRIMARY KEY (id), 
	CONSTRAINT fk_predictions_department_id_departments FOREIGN KEY(department_id) REFERENCES departments (id) ON DELETE RESTRICT, 
	CONSTRAINT fk_predictions_token_id_tokens FOREIGN KEY(token_id) REFERENCES tokens (id) ON DELETE SET NULL, 
	CONSTRAINT ck_predictions_queue_type CHECK (queue_type IN ('virtual', 'physical')), 
	CONSTRAINT ck_predictions_congestion_level CHECK (congestion_level IN ('low', 'medium', 'high', 'critical'))
);

CREATE INDEX ix_predictions_dept_generated ON predictions (department_id, generated_at);
CREATE INDEX ix_predictions_token_id ON predictions (token_id);

CREATE TABLE queue_history (
	id SERIAL NOT NULL, 
	token_id INTEGER, 
	department_id INTEGER NOT NULL, 
	doctor_id INTEGER, 
	visit_date DATE NOT NULL, 
	day_of_week SMALLINT NOT NULL, 
	hour_of_day SMALLINT NOT NULL, 
	priority SMALLINT NOT NULL, 
	source VARCHAR(20) NOT NULL, 
	final_status VARCHAR(20) NOT NULL, 
	virtual_queue_length_at_issue INTEGER NOT NULL, 
	physical_queue_length_at_issue INTEGER NOT NULL, 
	physical_queue_length_at_checkin INTEGER, 
	doctors_available_at_issue INTEGER NOT NULL, 
	arrival_delay_minutes FLOAT, 
	physical_wait_minutes FLOAT, 
	wait_minutes FLOAT, 
	consultation_minutes FLOAT, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_queue_history PRIMARY KEY (id), 
	CONSTRAINT ck_queue_history_dow_valid CHECK (day_of_week BETWEEN 0 AND 6), 
	CONSTRAINT ck_queue_history_hour_valid CHECK (hour_of_day BETWEEN 0 AND 23), 
	CONSTRAINT uq_queue_history_token_id UNIQUE (token_id), 
	CONSTRAINT fk_queue_history_token_id_tokens FOREIGN KEY(token_id) REFERENCES tokens (id) ON DELETE SET NULL, 
	CONSTRAINT fk_queue_history_department_id_departments FOREIGN KEY(department_id) REFERENCES departments (id) ON DELETE RESTRICT, 
	CONSTRAINT fk_queue_history_doctor_id_doctors FOREIGN KEY(doctor_id) REFERENCES doctors (id) ON DELETE SET NULL, 
	CONSTRAINT ck_queue_history_token_source CHECK (source IN ('app', 'walkin_qr', 'reception')), 
	CONSTRAINT ck_queue_history_token_status CHECK (final_status IN ('waiting', 'called', 'in_consultation', 'completed', 'skipped', 'cancelled', 'no_show'))
);

CREATE INDEX ix_queue_history_dept_date ON queue_history (department_id, visit_date);

CREATE TABLE notifications (
	id SERIAL NOT NULL, 
	patient_id INTEGER NOT NULL, 
	token_id INTEGER, 
	type VARCHAR(30) NOT NULL, 
	channel VARCHAR(10) NOT NULL, 
	title VARCHAR(120) NOT NULL, 
	body TEXT NOT NULL, 
	send_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	status VARCHAR(10) DEFAULT 'pending' NOT NULL, 
	sent_at TIMESTAMP WITH TIME ZONE, 
	read_at TIMESTAMP WITH TIME ZONE, 
	attempts INTEGER DEFAULT '0' NOT NULL, 
	last_error VARCHAR(500), 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	CONSTRAINT pk_notifications PRIMARY KEY (id), 
	CONSTRAINT fk_notifications_patient_id_patients FOREIGN KEY(patient_id) REFERENCES patients (id) ON DELETE CASCADE, 
	CONSTRAINT fk_notifications_token_id_tokens FOREIGN KEY(token_id) REFERENCES tokens (id) ON DELETE CASCADE, 
	CONSTRAINT ck_notifications_type CHECK (type IN ('token_issued', 'report_reminder', 'report_now', 'report_last_call', 'report_time_changed', 'checked_in', 'called', 'call_reminder', 'requeued', 'token_lapsed', 'reinstated')), 
	CONSTRAINT ck_notifications_channel CHECK (channel IN ('in_app', 'sms', 'push', 'email')), 
	CONSTRAINT ck_notifications_status CHECK (status IN ('pending', 'sent', 'failed', 'cancelled'))
);

CREATE INDEX ix_notifications_patient_id ON notifications (patient_id);
CREATE INDEX ix_notifications_token_id ON notifications (token_id);
CREATE INDEX ix_notifications_patient_inbox ON notifications (patient_id, channel, send_at);
CREATE INDEX ix_notifications_dispatch_due ON notifications (status, send_at);
CREATE UNIQUE INDEX uq_notifications_pending_dedup ON notifications (token_id, type, channel) WHERE status = 'pending';