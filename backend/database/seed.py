"""
Load sample data for development.

    python -m app.seed            # skips if data already exists
    python -m app.seed --force    # wipe all tables, then seed

Creates both queues: today's virtual tokens (not yet arrived), physical tokens (checked in via
rotating QR / staff scan), a walk-in QR token and a reception emergency, plus the QR stations
(one rotating check-in station per hospital, one static walk-in QR per department).
Includes ~14 days of SYNTHETIC queue_history so the ETA / congestion models have
something to train on. Replace it with real data as soon as you have it.

Dev logins created (change / remove before deploying):
    admin@queue.local           super_admin
    admin.citygeneral@queue.local, admin.lifeline@queue.local   hospital_admin
    password for all: ChangeMe123!
"""
import argparse
import hashlib
import os
import random
from datetime import date, datetime, time, timedelta, timezone

from database import models as m
from database.db import session_scope
from database.models import Base
from database.db import engine

random.seed(42)

DEV_PASSWORD = "ChangeMe123!"


def dev_hash(password: str) -> str:
    """PBKDF2 for seed data only. Use bcrypt/argon2 (passlib) in the real auth layer."""
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"pbkdf2_sha256$200000${salt.hex()}${digest.hex()}"


HOSPITALS = [
    dict(name="City General Hospital", city="New Delhi", state="Delhi", postal_code="110001",
         address="12 Hospital Road", phone="011-40001000", email="info@citygeneral.example",
         opens_at=time(8, 0), closes_at=time(20, 0)),
    dict(name="Lifeline Medical Centre", city="New Delhi", state="Delhi", postal_code="110016",
         address="45 Health Avenue", phone="011-40002000", email="info@lifeline.example",
         opens_at=time(9, 0), closes_at=time(18, 0)),
]

# (name, code, avg consult minutes)
DEPARTMENTS = [
    ("General Medicine", "GEN", 10),
    ("Cardiology", "CAR", 15),
    ("Orthopaedics", "ORT", 12),
    ("Paediatrics", "PED", 10),
    ("Dermatology", "DER", 8),
]

DOCTOR_NAMES = [
    "Anil Sharma", "Priya Nair", "Rohit Verma", "Sunita Rao", "Vikram Singh",
    "Neha Kapoor", "Arjun Mehta", "Kavita Iyer", "Sanjay Gupta", "Meera Joshi",
    "Rahul Bansal", "Anjali Desai", "Manish Malhotra", "Pooja Chawla", "Karan Saxena",
    "Divya Menon", "Amit Khanna", "Shweta Bhatt", "Nitin Arora", "Ritu Sethi",
]
FIRST = ["Aarav", "Vivaan", "Diya", "Ishaan", "Ananya", "Kabir", "Saanvi", "Reyansh", "Myra",
         "Aditya", "Kiara", "Arnav", "Riya", "Dhruv", "Tara", "Yash", "Nisha", "Om", "Pari", "Zoya"]
LAST = ["Sharma", "Verma", "Gupta", "Singh", "Kumar", "Jain", "Agarwal", "Yadav", "Reddy", "Khan"]


def utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc)


def seed(db) -> None:
    pw = dev_hash(DEV_PASSWORD)

    # --- hospitals, departments, doctors, staff ---------------------------- #
    db.add(m.StaffUser(full_name="Super Admin", email="admin@queue.local",
                       password_hash=pw, role=m.StaffRole.SUPER_ADMIN))
    hospitals, doctors_by_dept = [], {}
    staff_by_hosp, checkin_by_hosp, walkin_by_dept = {}, {}, {}
    name_iter = iter(DOCTOR_NAMES * 2)
    for h in HOSPITALS:
        hospital = m.Hospital(**h)
        db.add(hospital)
        db.flush()
        hospitals.append(hospital)
        slug = h["name"].split()[0].lower()
        staff = m.StaffUser(hospital_id=hospital.id, full_name=f"{h['name']} Admin",
                            email=f"admin.{slug}@queue.local", password_hash=pw,
                            role=m.StaffRole.HOSPITAL_ADMIN)
        db.add(staff)
        checkin = m.QRStation(hospital_id=hospital.id, name="Main Reception (check-in)",
                              purpose=m.QRPurpose.CHECK_IN, rotation_seconds=30)
        db.add(checkin)
        db.flush()
        staff_by_hosp[hospital.id] = staff
        checkin_by_hosp[hospital.id] = checkin
        for name, code, mins in DEPARTMENTS:
            dept = m.Department(hospital_id=hospital.id, name=name, code=code,
                                avg_consult_minutes=mins, max_daily_tokens=150)
            db.add(dept)
            db.flush()
            docs = []
            for i in range(2):
                status = m.DoctorStatus.AVAILABLE if i == 0 else random.choice(
                    [m.DoctorStatus.AVAILABLE, m.DoctorStatus.ON_BREAK])
                d = m.Doctor(department_id=dept.id, full_name=f"Dr. {next(name_iter)}",
                             specialization=name, qualification="MBBS, MD", status=status,
                             shift_start=time(9, 0), shift_end=time(17, 0))
                db.add(d)
                docs.append(d)
            walkin = m.QRStation(hospital_id=hospital.id, department_id=dept.id,
                                 name=f"{name} walk-in QR", purpose=m.QRPurpose.WALK_IN,
                                 rotation_seconds=None)  # static printed poster
            db.add(walkin)
            db.flush()
            doctors_by_dept[dept.id] = docs
            walkin_by_dept[dept.id] = walkin

    # --- patients ---------------------------------------------------------- #
    patients = []
    for i in range(40):
        p = m.Patient(
            full_name=f"{random.choice(FIRST)} {random.choice(LAST)}",
            phone=f"98{10000000 + i * 7919:08d}"[:10],
            email=f"patient{i + 1}@example.com",
            password_hash=pw,
            date_of_birth=date(1950 + random.randint(0, 55), random.randint(1, 12), random.randint(1, 28)),
            gender=random.choice(list(m.Gender)),
        )
        db.add(p)
        patients.append(p)
    db.flush()

    departments = db.query(m.Department).all()

    # --- synthetic history (ML training data) ------------------------------ #
    today = date.today()
    for day_offset in range(14, 0, -1):
        visit_date = today - timedelta(days=day_offset)
        for dept in departments:
            n_visits = random.randint(20, 45)
            docs_avail = random.choice([1, 2, 2])
            for _ in range(n_visits):
                hour = random.choices(range(9, 17), weights=[3, 5, 6, 5, 3, 3, 4, 2])[0]
                source = random.choices(list(m.TokenSource), weights=[60, 30, 10])[0]
                status = random.choices(
                    [m.TokenStatus.COMPLETED, m.TokenStatus.SKIPPED,
                     m.TokenStatus.CANCELLED, m.TokenStatus.NO_SHOW],
                    weights=[86, 5, 4, 5])[0]
                if status == m.TokenStatus.NO_SHOW and source != m.TokenSource.APP:
                    status = m.TokenStatus.COMPLETED   # only remote bookings can be no-shows
                done = status == m.TokenStatus.COMPLETED

                phys_q = max(0, int(random.gauss(2 + (hour in (10, 11, 12)) * 4, 2)))
                virt_q = max(0, int(random.gauss(2, 1.5)))
                at_checkin = phys_q if source != m.TokenSource.APP else max(0, phys_q + random.randint(-2, 3))
                delay = 0.0 if source != m.TokenSource.APP else max(5.0, random.gauss(25, 10))
                phys_wait = max(0.0, at_checkin * dept.avg_consult_minutes / docs_avail + random.gauss(0, 4))
                consult = max(3.0, random.gauss(dept.avg_consult_minutes, 3))

                db.add(m.QueueHistory(
                    department_id=dept.id, visit_date=visit_date,
                    day_of_week=visit_date.weekday(), hour_of_day=hour,
                    priority=random.choices([0, 1, 2], weights=[3, 12, 85])[0],
                    source=source, final_status=status,
                    virtual_queue_length_at_issue=virt_q,
                    physical_queue_length_at_issue=phys_q,
                    physical_queue_length_at_checkin=at_checkin if done else None,
                    doctors_available_at_issue=docs_avail,
                    arrival_delay_minutes=round(delay, 1) if done else None,
                    physical_wait_minutes=round(phys_wait, 1) if done else None,
                    wait_minutes=round(delay + phys_wait, 1) if done else None,
                    consultation_minutes=round(consult, 1) if done else None,
                ))

    # --- today's live queues ----------------------------------------------- #
    # n=1,2 seen | 3 in consultation | 4,5 physical waiting (checked in via rotating QR)
    # n=6,7 virtual waiting (not arrived yet) | 8 walk-in via QR | 9 reception emergency
    now = datetime.now(timezone.utc)
    P, V = m.QueueType.PHYSICAL, m.QueueType.VIRTUAL
    for dept in departments:
        docs = doctors_by_dept[dept.id]
        hosp_id = dept.hospital_id
        checkin_station = checkin_by_hosp[hosp_id]
        walkin_station = walkin_by_dept[dept.id]
        staff = staff_by_hosp[hosp_id]
        chosen = random.sample(patients, 9)
        for n, patient in enumerate(chosen, start=1):
            issued = now - timedelta(minutes=(10 - n) * 7)
            token = m.Token(
                token_number=n, token_date=today, patient_id=patient.id, department_id=dept.id,
                priority=int(m.TokenPriority.NORMAL), issued_at=issued,
                position_at_issue=max(0, n - 1), reason="Routine consultation",
                queue_type=V, source=m.TokenSource.APP, status=m.TokenStatus.WAITING,
            )
            if n <= 5:                      # remote booking, arrived -> physical queue
                token.queue_type = P
                token.checked_in_at = issued + timedelta(minutes=8)
                if n == 3:
                    token.check_in_method = m.CheckInMethod.TOKEN_QR_SCAN   # staff scanned patient QR
                    token.checked_in_by_id = staff.id
                else:
                    token.check_in_method = m.CheckInMethod.DYNAMIC_QR      # patient scanned staff QR
                    token.qr_station_id = checkin_station.id
                if n <= 2:
                    token.status = m.TokenStatus.COMPLETED
                    token.doctor_id = docs[0].id
                    token.called_at = token.checked_in_at + timedelta(minutes=5)
                    token.consultation_started_at = token.called_at + timedelta(minutes=1)
                    token.completed_at = token.consultation_started_at + timedelta(minutes=dept.avg_consult_minutes)
                elif n == 3:
                    token.status = m.TokenStatus.IN_CONSULTATION
                    token.doctor_id = docs[0].id
                    token.called_at = now - timedelta(minutes=6)
                    token.consultation_started_at = now - timedelta(minutes=5)
                else:
                    token.predicted_wait_minutes = (n - 3) * dept.avg_consult_minutes
            elif n in (6, 7):               # still virtual, patient not on site
                token.predicted_wait_minutes = (n - 3) * dept.avg_consult_minutes + 10
            elif n == 8:                    # walk-in: scanned the department's static QR
                token.source = m.TokenSource.WALKIN_QR
                token.queue_type = P
                token.checked_in_at = issued
                token.check_in_method = m.CheckInMethod.WALKIN_QR
                token.qr_station_id = walkin_station.id
                token.predicted_wait_minutes = 3 * dept.avg_consult_minutes
            else:                           # n == 9: emergency registered at the desk
                token.source = m.TokenSource.RECEPTION
                token.queue_type = P
                token.priority = int(m.TokenPriority.EMERGENCY)
                token.checked_in_at = issued
                token.check_in_method = m.CheckInMethod.MANUAL
                token.checked_in_by_id = staff.id
                token.reason = "Chest pain"
                token.predicted_wait_minutes = 0
            db.add(token)

        avail = len([d for d in docs if d.status == m.DoctorStatus.AVAILABLE])
        db.add(m.QueueSnapshot(department_id=dept.id, virtual_waiting_count=2,
                               physical_waiting_count=4, in_consultation_count=1,
                               doctors_available=avail, avg_physical_wait_minutes=22.5))
        db.add(m.Prediction(department_id=dept.id, queue_type=P, horizon_minutes=30,
                            predicted_wait_minutes=25, predicted_queue_length=6,
                            congestion_level=m.CongestionLevel.MEDIUM, confidence=0.78,
                            model_version="seed-v0"))
        db.add(m.Prediction(department_id=dept.id, queue_type=V, horizon_minutes=30,
                            predicted_wait_minutes=45, predicted_queue_length=3,
                            congestion_level=m.CongestionLevel.LOW, confidence=0.7,
                            model_version="seed-v0"))

    db.add(m.Alert(hospital_id=hospitals[0].id, department_id=departments[1].id,
                   alert_type=m.AlertType.CONGESTION, severity=m.AlertSeverity.WARNING,
                   message="Cardiology queue is above normal load."))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawTextHelpFormatter)
    parser.add_argument("--force", action="store_true", help="wipe all tables first")
    args = parser.parse_args()

    if args.force:
        Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)

    with session_scope() as db:
        if db.query(m.Hospital).count() and not args.force:
            print("Data already present - use --force to wipe and reseed.")
            return
        seed(db)
    print("Seed complete.")


if __name__ == "__main__":
    main()
