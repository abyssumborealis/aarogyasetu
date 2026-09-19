"""
SQLAlchemy 2.0 models for the Smart Hospital Queue Management System.

Tables
------
hospitals, departments, doctors, patients, staff_users   -> master data
qr_stations                                              -> QR sources: staff check-in QR + offline walk-in QR
tokens                                                   -> live queues (one row per digital token)
queue_history                                            -> completed-visit facts (ML training data)
queue_snapshots                                          -> periodic department load (ML / congestion)
predictions                                              -> output of the AI / Prediction API
alerts                                                   -> hospital dashboard alerts

Two queues
----------
* VIRTUAL queue  - patient books remotely via the app. The token carries a STATIC QR
                   (tokens.public_id) for tracking. The patient is NOT physically present.
* PHYSICAL queue - patient is at the hospital. Only physical tokens can be called.

A token moves virtual -> physical when it is CHECKED IN, by one of:
  dynamic_qr     patient scans the rotating QR shown only on a staff screen (qr_stations, purpose=check_in)
  token_qr_scan  staff scans the patient's static token QR
  manual         staff clicks "arrived"
Walk-ins skip the virtual queue: they scan a walk-in QR (qr_stations, purpose=walk_in) or are
registered at the desk, and are created directly as physical tokens.

Token numbers come from ONE sequence per department per day, shared by both queues, so a
token keeps its number/code when it moves between queues.

Conventions
-----------
* Nothing is hard-deleted: use `is_active` flags. Foreign keys are RESTRICT,
  except optional references, which are SET NULL.
* Enums are stored as VARCHAR + CHECK constraint (not native PG enums), which
  keeps Alembic migrations painless.
* Token priority is an integer so it can be sorted directly:
  0 = emergency, 1 = priority (senior / pregnant / disabled), 2 = normal.
"""
from __future__ import annotations

import enum
import secrets
import uuid
from datetime import date, datetime, time
from typing import List, Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    MetaData,
    SmallInteger,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship
from sqlalchemy.sql import expression

# --------------------------------------------------------------------------- #
# Base + naming convention (makes Alembic autogenerate produce stable names)
# --------------------------------------------------------------------------- #
NAMING_CONVENTION = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


# --------------------------------------------------------------------------- #
# Enums
# --------------------------------------------------------------------------- #
class Gender(str, enum.Enum):
    MALE = "male"
    FEMALE = "female"
    OTHER = "other"


class DoctorStatus(str, enum.Enum):
    AVAILABLE = "available"
    ON_BREAK = "on_break"
    OFF_DUTY = "off_duty"


class TokenPriority(enum.IntEnum):
    EMERGENCY = 0
    PRIORITY = 1
    NORMAL = 2


class QueueType(str, enum.Enum):
    VIRTUAL = "virtual"    # booked remotely, patient not yet at the hospital
    PHYSICAL = "physical"  # patient is present at the hospital


class TokenSource(str, enum.Enum):
    """How the token was created."""
    APP = "app"            # remote booking (starts in the virtual queue)
    WALKIN_QR = "walkin_qr"  # patient scanned an offline walk-in QR
    RECEPTION = "reception"  # staff registered the patient at the desk


class CheckInMethod(str, enum.Enum):
    """How the patient's physical presence was confirmed."""
    DYNAMIC_QR = "dynamic_qr"      # patient scanned the rotating staff-side QR
    TOKEN_QR_SCAN = "token_qr_scan"  # staff scanned the patient's static token QR
    MANUAL = "manual"              # staff pressed "arrived" / registered at desk
    WALKIN_QR = "walkin_qr"        # joined the physical queue via a walk-in QR


class QRPurpose(str, enum.Enum):
    CHECK_IN = "check_in"  # confirms arrival of a virtual token (always rotating, staff-only)
    WALK_IN = "walk_in"    # direct entry into the physical queue (static or rotating)


class TokenStatus(str, enum.Enum):
    WAITING = "waiting"
    CALLED = "called"
    IN_CONSULTATION = "in_consultation"
    COMPLETED = "completed"
    SKIPPED = "skipped"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"    # virtual token whose patient never arrived


class StaffRole(str, enum.Enum):
    SUPER_ADMIN = "super_admin"
    HOSPITAL_ADMIN = "hospital_admin"
    RECEPTIONIST = "receptionist"
    DOCTOR = "doctor"


class CongestionLevel(str, enum.Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


class AlertType(str, enum.Enum):
    CONGESTION = "congestion"
    LONG_WAIT = "long_wait"
    DOCTOR_UNAVAILABLE = "doctor_unavailable"
    EMERGENCY_TOKEN = "emergency_token"
    SYSTEM = "system"


class AlertSeverity(str, enum.Enum):
    INFO = "info"
    WARNING = "warning"
    CRITICAL = "critical"


class NotificationType(str, enum.Enum):
    TOKEN_ISSUED = "token_issued"              # virtual token created: told when to report
    REPORT_REMINDER = "report_reminder"        # "leave soon" nudge before report_by_at
    REPORT_NOW = "report_now"                  # report_by_at has arrived
    REPORT_LAST_CALL = "report_last_call"      # close to report_deadline_at
    REPORT_TIME_CHANGED = "report_time_changed"  # queue moved, reporting window re-planned
    CHECKED_IN = "checked_in"                  # entered the physical queue
    CALLED = "called"                          # doctor called them
    CALL_REMINDER = "call_reminder"            # called but hasn't shown up yet
    REQUEUED = "requeued"                      # missed a call, sent to back of the line
    TOKEN_LAPSED = "token_lapsed"              # closed as NO_SHOW
    REINSTATED = "reinstated"                  # staff put a no-show token back in the queue


class NotificationChannel(str, enum.Enum):
    IN_APP = "in_app"
    SMS = "sms"
    PUSH = "push"
    EMAIL = "email"


class NotificationStatus(str, enum.Enum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    CANCELLED = "cancelled"


def _enum(py_enum: type[enum.Enum], name: str) -> Enum:
    """String-backed enum stored as VARCHAR with a CHECK constraint."""
    return Enum(
        py_enum,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=20,
        validate_strings=True,
        values_callable=lambda e: [m.value for m in e],
    )


ACTIVE_TOKEN_STATES = "('waiting','called','in_consultation')"


# --------------------------------------------------------------------------- #
# Master data
# --------------------------------------------------------------------------- #
class Hospital(TimestampMixin, Base):
    __tablename__ = "hospitals"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    address: Mapped[Optional[str]] = mapped_column(String(255))
    city: Mapped[str] = mapped_column(String(80), nullable=False, index=True)
    state: Mapped[Optional[str]] = mapped_column(String(80))
    postal_code: Mapped[Optional[str]] = mapped_column(String(12))
    phone: Mapped[Optional[str]] = mapped_column(String(20))
    email: Mapped[Optional[str]] = mapped_column(String(120))
    opens_at: Mapped[Optional[time]] = mapped_column(Time)
    closes_at: Mapped[Optional[time]] = mapped_column(Time)
    is_active: Mapped[bool] = mapped_column(
        Boolean, server_default=expression.true(), nullable=False
    )

    departments: Mapped[List["Department"]] = relationship(back_populates="hospital")
    staff: Mapped[List["StaffUser"]] = relationship(back_populates="hospital")
    alerts: Mapped[List["Alert"]] = relationship(back_populates="hospital")

    __table_args__ = (
        UniqueConstraint("name", "city", name="uq_hospitals_name_city"),
    )


class Department(TimestampMixin, Base):
    __tablename__ = "departments"

    id: Mapped[int] = mapped_column(primary_key=True)
    hospital_id: Mapped[int] = mapped_column(
        ForeignKey("hospitals.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str] = mapped_column(String(6), nullable=False)  # e.g. "CAR" -> CAR-014
    description: Mapped[Optional[str]] = mapped_column(Text)
    # Fallback service time used by ETA logic until the ML model has enough data
    avg_consult_minutes: Mapped[int] = mapped_column(
        Integer, default=10, server_default="10", nullable=False
    )
    max_daily_tokens: Mapped[Optional[int]] = mapped_column(Integer)
    # How long a virtual patient has, after report_by_at, before their token lapses to NO_SHOW.
    report_grace_minutes: Mapped[int] = mapped_column(
        Integer, default=20, server_default="20", nullable=False
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, server_default=expression.true(), nullable=False
    )

    hospital: Mapped["Hospital"] = relationship(back_populates="departments")
    doctors: Mapped[List["Doctor"]] = relationship(back_populates="department")
    tokens: Mapped[List["Token"]] = relationship(back_populates="department")

    __table_args__ = (
        UniqueConstraint("hospital_id", "name", name="uq_departments_hospital_name"),
        UniqueConstraint("hospital_id", "code", name="uq_departments_hospital_code"),
        CheckConstraint("avg_consult_minutes > 0", name="avg_consult_positive"),
    )


class Doctor(TimestampMixin, Base):
    __tablename__ = "doctors"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    specialization: Mapped[Optional[str]] = mapped_column(String(120))
    qualification: Mapped[Optional[str]] = mapped_column(String(120))
    phone: Mapped[Optional[str]] = mapped_column(String(20))
    email: Mapped[Optional[str]] = mapped_column(String(120))
    status: Mapped[DoctorStatus] = mapped_column(
        _enum(DoctorStatus, "doctor_status"),
        default=DoctorStatus.OFF_DUTY,  # becomes 'available' when the doctor checks in
        server_default=DoctorStatus.OFF_DUTY.value,
        nullable=False,
    )
    shift_start: Mapped[Optional[time]] = mapped_column(Time)
    shift_end: Mapped[Optional[time]] = mapped_column(Time)
    is_active: Mapped[bool] = mapped_column(
        Boolean, server_default=expression.true(), nullable=False
    )

    department: Mapped["Department"] = relationship(back_populates="doctors")
    tokens: Mapped[List["Token"]] = relationship(back_populates="doctor")


class Patient(TimestampMixin, Base):
    __tablename__ = "patients"

    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    phone: Mapped[str] = mapped_column(String(20), nullable=False, unique=True)
    email: Mapped[Optional[str]] = mapped_column(String(120), unique=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255))
    date_of_birth: Mapped[Optional[date]] = mapped_column(Date)
    gender: Mapped[Optional[Gender]] = mapped_column(_enum(Gender, "gender"))
    is_active: Mapped[bool] = mapped_column(
        Boolean, server_default=expression.true(), nullable=False
    )

    tokens: Mapped[List["Token"]] = relationship(back_populates="patient")


class StaffUser(TimestampMixin, Base):
    """Hospital dashboard logins. hospital_id is NULL for super admins."""

    __tablename__ = "staff_users"

    id: Mapped[int] = mapped_column(primary_key=True)
    hospital_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("hospitals.id", ondelete="RESTRICT"), index=True
    )
    full_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[StaffRole] = mapped_column(
        _enum(StaffRole, "staff_role"),
        default=StaffRole.RECEPTIONIST,
        nullable=False,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean, server_default=expression.true(), nullable=False
    )

    hospital: Mapped[Optional["Hospital"]] = relationship(back_populates="staff")


# --------------------------------------------------------------------------- #
# QR sources
# --------------------------------------------------------------------------- #
class QRStation(TimestampMixin, Base):
    """
    A place that emits a QR code.

    * purpose=check_in : staff-only screen/desk. The QR ROTATES every `rotation_seconds`
      (required). Payload = "<public_id>.<otp>", otp = HMAC(secret, time_window). Shown only
      inside the authenticated staff dashboard, so scanning proves the patient is on site.
    * purpose=walk_in  : gives direct access to the PHYSICAL queue. `rotation_seconds` NULL =
      static printed poster (payload = public_id); set it to rotate on a screen instead.

    Rotation is stateless (nothing is written per rotation), see app/qr_codes.py.
    department_id NULL = hospital-wide (the patient/staff picks the department).
    """

    __tablename__ = "qr_stations"

    id: Mapped[int] = mapped_column(primary_key=True)
    public_id: Mapped[str] = mapped_column(
        String(32), nullable=False, unique=True, default=lambda: uuid.uuid4().hex
    )
    hospital_id: Mapped[int] = mapped_column(
        ForeignKey("hospitals.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    department_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("departments.id", ondelete="RESTRICT")
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)  # "Main Reception"
    purpose: Mapped[QRPurpose] = mapped_column(_enum(QRPurpose, "qr_purpose"), nullable=False)
    # HMAC key for rotating codes. Must be recoverable, so keep the DB encrypted at rest.
    secret: Mapped[str] = mapped_column(
        String(64), nullable=False, default=lambda: secrets.token_hex(32)
    )
    rotation_seconds: Mapped[Optional[int]] = mapped_column(Integer)
    is_active: Mapped[bool] = mapped_column(
        Boolean, server_default=expression.true(), nullable=False
    )

    __table_args__ = (
        UniqueConstraint("hospital_id", "name", name="uq_qr_stations_hospital_name"),
        CheckConstraint(
            "purpose <> 'check_in' OR rotation_seconds IS NOT NULL",
            name="checkin_must_rotate",
        ),
        CheckConstraint(
            "rotation_seconds IS NULL OR rotation_seconds BETWEEN 10 AND 3600",
            name="rotation_range",
        ),
    )


# --------------------------------------------------------------------------- #
# Live queues
# --------------------------------------------------------------------------- #
class Token(Base):
    """
    One digital token. Token numbers restart every day, per department, and are shared by
    the virtual and physical queues. `queue_type` says which queue the token is in NOW.
    """

    __tablename__ = "tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    # Payload of the patient's STATIC QR (also used for public status links). Non-guessable.
    public_id: Mapped[str] = mapped_column(
        String(32), nullable=False, unique=True, default=lambda: uuid.uuid4().hex
    )
    token_number: Mapped[int] = mapped_column(Integer, nullable=False)
    token_date: Mapped[date] = mapped_column(
        Date, default=date.today, server_default=func.current_date(), nullable=False
    )

    patient_id: Mapped[int] = mapped_column(
        ForeignKey("patients.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    # department_id is already the leading column of the two queue indexes below
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="RESTRICT"), nullable=False
    )
    doctor_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("doctors.id", ondelete="SET NULL"), index=True
    )

    priority: Mapped[int] = mapped_column(
        SmallInteger,
        default=int(TokenPriority.NORMAL),
        server_default=str(int(TokenPriority.NORMAL)),
        nullable=False,
    )
    status: Mapped[TokenStatus] = mapped_column(
        _enum(TokenStatus, "token_status"),
        default=TokenStatus.WAITING,
        server_default=TokenStatus.WAITING.value,
        nullable=False,
    )
    reason: Mapped[Optional[str]] = mapped_column(Text)  # symptoms / visit reason

    # --- which queue, and how the token got here ---------------------------- #
    queue_type: Mapped[QueueType] = mapped_column(
        _enum(QueueType, "queue_type"),
        default=QueueType.VIRTUAL,
        server_default=QueueType.VIRTUAL.value,
        nullable=False,
    )
    source: Mapped[TokenSource] = mapped_column(
        _enum(TokenSource, "token_source"),
        default=TokenSource.APP,
        server_default=TokenSource.APP.value,
        nullable=False,
    )
    # Set when the token enters the physical queue (walk-ins: at creation)
    checked_in_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    check_in_method: Mapped[Optional[CheckInMethod]] = mapped_column(
        _enum(CheckInMethod, "check_in_method")
    )
    checked_in_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("staff_users.id", ondelete="SET NULL")
    )  # staff member for token_qr_scan / manual / reception
    qr_station_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("qr_stations.id", ondelete="SET NULL")
    )  # station whose QR was scanned (dynamic_qr / walkin_qr)

    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    called_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    consultation_started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True)
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # Snapshot taken when the token is issued (position in the queue it joined)
    position_at_issue: Mapped[Optional[int]] = mapped_column(Integer)
    predicted_wait_minutes: Mapped[Optional[int]] = mapped_column(Integer)

    # --- ETA feature snapshots, copied onto queue_history once the token finishes ------- #
    virtual_queue_length_at_issue: Mapped[Optional[int]] = mapped_column(Integer)
    physical_queue_length_at_issue: Mapped[Optional[int]] = mapped_column(Integer)
    physical_queue_length_at_checkin: Mapped[Optional[int]] = mapped_column(Integer)
    doctors_available_at_issue: Mapped[Optional[int]] = mapped_column(Integer)

    # --- reporting window (virtual tokens only) + call timing --------------------------- #
    # When we currently expect this token to actually be called (re-planned as the queue moves)
    expected_call_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # "Please be at the hospital by this time" - shown to the patient, drives REPORT_* notifications
    report_by_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    # Check in by this time or the token lapses to NO_SHOW (report_by_at + department's grace window)
    report_deadline_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    # How many times this token has been called and the patient wasn't there (see mark_absent()).
    # Requeued while <= settings.max_absent_recalls, NO_SHOW once it goes over.
    absence_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

    patient: Mapped["Patient"] = relationship(back_populates="tokens")
    department: Mapped["Department"] = relationship(back_populates="tokens")
    doctor: Mapped[Optional["Doctor"]] = relationship(back_populates="tokens")

    __table_args__ = (
        UniqueConstraint(
            "department_id", "token_date", "token_number", name="uq_tokens_dept_date_number"
        ),
        CheckConstraint("priority IN (0, 1, 2)", name="priority_valid"),
        CheckConstraint("token_number > 0", name="number_positive"),
        # Only patients who are present can be called / seen
        CheckConstraint(
            "queue_type = 'physical' OR status NOT IN ('called','in_consultation','completed')",
            name="virtual_not_called",
        ),
        CheckConstraint(
            "queue_type = 'virtual' OR checked_in_at IS NOT NULL",
            name="physical_has_checkin",
        ),
        CheckConstraint(
            "(checked_in_at IS NULL AND check_in_method IS NULL) "
            "OR (checked_in_at IS NOT NULL AND check_in_method IS NOT NULL)",
            name="checkin_fields_together",
        ),
        # Walk-in / reception tokens never live in the virtual queue
        CheckConstraint("source = 'app' OR queue_type = 'physical'", name="offline_source_is_physical"),
        # Virtual queue order: priority, then booking time
        Index(
            "ix_tokens_virtual_queue",
            "department_id", "token_date", "status", "priority", "issued_at",
            postgresql_where=text("queue_type = 'virtual'"),
            sqlite_where=text("queue_type = 'virtual'"),
        ),
        # Physical queue order: priority, then time of arrival
        Index(
            "ix_tokens_physical_queue",
            "department_id", "token_date", "status", "priority", "checked_in_at",
            postgresql_where=text("queue_type = 'physical'"),
            sqlite_where=text("queue_type = 'physical'"),
        ),
        # A patient can hold only one active token per department per day (either queue)
        Index(
            "uq_tokens_one_active_per_patient_dept",
            "patient_id", "department_id", "token_date",
            unique=True,
            postgresql_where=text(f"status IN {ACTIVE_TOKEN_STATES}"),
            sqlite_where=text(f"status IN {ACTIVE_TOKEN_STATES}"),
        ),
    )

    @property
    def display_code(self) -> str:
        """Human-friendly code shown to the patient, e.g. 'CAR-014'."""
        return f"{self.department.code}-{self.token_number:03d}"


# --------------------------------------------------------------------------- #
# Analytics / AI-ML support
# --------------------------------------------------------------------------- #
class QueueHistory(Base):
    """
    One row per finished token (completed / skipped / cancelled). Denormalised
    on purpose: this is the training table for the ETA and queue models.
    token_id is nullable so historical data can be imported without live tokens.
    """

    __tablename__ = "queue_history"

    id: Mapped[int] = mapped_column(primary_key=True)
    token_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tokens.id", ondelete="SET NULL"), unique=True
    )
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="RESTRICT"), nullable=False
    )
    doctor_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("doctors.id", ondelete="SET NULL")
    )
    visit_date: Mapped[date] = mapped_column(Date, nullable=False)
    day_of_week: Mapped[int] = mapped_column(SmallInteger, nullable=False)  # 0=Mon
    hour_of_day: Mapped[int] = mapped_column(SmallInteger, nullable=False)  # issue hour
    priority: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    source: Mapped[TokenSource] = mapped_column(_enum(TokenSource, "token_source"), nullable=False)
    final_status: Mapped[TokenStatus] = mapped_column(
        _enum(TokenStatus, "token_status"), nullable=False
    )
    # Features known when the token was issued / checked in
    virtual_queue_length_at_issue: Mapped[int] = mapped_column(Integer, nullable=False)
    physical_queue_length_at_issue: Mapped[int] = mapped_column(Integer, nullable=False)
    physical_queue_length_at_checkin: Mapped[Optional[int]] = mapped_column(Integer)
    doctors_available_at_issue: Mapped[int] = mapped_column(Integer, nullable=False)
    # Targets
    arrival_delay_minutes: Mapped[Optional[float]] = mapped_column(Float)  # issue -> check-in (0 for walk-ins)
    physical_wait_minutes: Mapped[Optional[float]] = mapped_column(Float)  # check-in -> consult start
    wait_minutes: Mapped[Optional[float]] = mapped_column(Float)           # issue -> consult start (total)
    consultation_minutes: Mapped[Optional[float]] = mapped_column(Float)   # consult start -> end
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_queue_history_dept_date", "department_id", "visit_date"),
        CheckConstraint("day_of_week BETWEEN 0 AND 6", name="dow_valid"),
        CheckConstraint("hour_of_day BETWEEN 0 AND 23", name="hour_valid"),
    )


class QueueSnapshot(Base):
    """Periodic department load, written by a scheduler every few minutes."""

    __tablename__ = "queue_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="RESTRICT"), nullable=False
    )
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    virtual_waiting_count: Mapped[int] = mapped_column(Integer, nullable=False)
    physical_waiting_count: Mapped[int] = mapped_column(Integer, nullable=False)
    in_consultation_count: Mapped[int] = mapped_column(Integer, nullable=False)
    doctors_available: Mapped[int] = mapped_column(Integer, nullable=False)
    avg_physical_wait_minutes: Mapped[Optional[float]] = mapped_column(Float)

    __table_args__ = (
        Index("ix_queue_snapshots_dept_time", "department_id", "captured_at"),
    )


class Prediction(Base):
    """Results returned by the Prediction API (waiting time, future queue, congestion)."""

    __tablename__ = "predictions"

    id: Mapped[int] = mapped_column(primary_key=True)
    department_id: Mapped[int] = mapped_column(
        ForeignKey("departments.id", ondelete="RESTRICT"), nullable=False
    )
    token_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tokens.id", ondelete="SET NULL"), index=True
    )
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    # Which queue the prediction is about; NULL = department as a whole
    queue_type: Mapped[Optional[QueueType]] = mapped_column(_enum(QueueType, "queue_type"))
    horizon_minutes: Mapped[Optional[int]] = mapped_column(Integer)  # "queue in N min"
    predicted_wait_minutes: Mapped[Optional[int]] = mapped_column(Integer)
    predicted_queue_length: Mapped[Optional[int]] = mapped_column(Integer)
    congestion_level: Mapped[Optional[CongestionLevel]] = mapped_column(
        _enum(CongestionLevel, "congestion_level")
    )
    confidence: Mapped[Optional[float]] = mapped_column(Float)
    model_version: Mapped[Optional[str]] = mapped_column(String(50))

    __table_args__ = (
        Index("ix_predictions_dept_generated", "department_id", "generated_at"),
    )


class Alert(Base):
    """Alerts shown on the hospital dashboard."""

    __tablename__ = "alerts"

    id: Mapped[int] = mapped_column(primary_key=True)
    hospital_id: Mapped[int] = mapped_column(
        ForeignKey("hospitals.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    department_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("departments.id", ondelete="SET NULL")
    )
    alert_type: Mapped[AlertType] = mapped_column(
        _enum(AlertType, "alert_type"), nullable=False
    )
    severity: Mapped[AlertSeverity] = mapped_column(
        _enum(AlertSeverity, "alert_severity"),
        default=AlertSeverity.INFO,
        nullable=False,
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    is_resolved: Mapped[bool] = mapped_column(
        Boolean, server_default=expression.false(), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    resolved_by_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("staff_users.id", ondelete="SET NULL")
    )

    hospital: Mapped["Hospital"] = relationship(back_populates="alerts")

    __table_args__ = (
        Index("ix_alerts_hospital_open", "hospital_id", "is_resolved", "created_at"),
    )


class Notification(Base):
    """
    Outbox row: one per (token, notification type, channel). `in_app` rows need no delivery -
    they're simply visible in the patient's inbox once send_at has passed (see services/notify.py).
    Other channels are sent by dispatch_due() via a registered sender (e.g. Twilio for SMS).
    """

    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(primary_key=True)
    patient_id: Mapped[int] = mapped_column(
        ForeignKey("patients.id", ondelete="CASCADE"), nullable=False, index=True
    )
    token_id: Mapped[Optional[int]] = mapped_column(
        ForeignKey("tokens.id", ondelete="CASCADE"), index=True
    )
    type: Mapped[NotificationType] = mapped_column(
        _enum(NotificationType, "notification_type"), nullable=False
    )
    channel: Mapped[NotificationChannel] = mapped_column(
        _enum(NotificationChannel, "notification_channel"), nullable=False
    )
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    send_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[NotificationStatus] = mapped_column(
        _enum(NotificationStatus, "notification_status"),
        default=NotificationStatus.PENDING,
        server_default=NotificationStatus.PENDING.value,
        nullable=False,
    )
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    read_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))  # in_app inbox only
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    last_error: Mapped[Optional[str]] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    __table_args__ = (
        Index("ix_notifications_patient_inbox", "patient_id", "channel", "send_at"),
        Index("ix_notifications_dispatch_due", "status", "send_at"),
        # One pending message per (token, type, channel) at a time - enqueue() relies on this to
        # silently drop duplicate reminders instead of stacking them up.
        Index(
            "uq_notifications_pending_dedup",
            "token_id", "type", "channel",
            unique=True,
            postgresql_where=text("status = 'pending'"),
            sqlite_where=text("status = 'pending'"),
        ),
    )