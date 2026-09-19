/**
 * QUEUE — Static Data & Constants
 * Maps directly to FastAPI backend models (TokenOut, QueueType, TokenStatus, TokenPriority)
 */

export const SYSTEM_STATES = {
  PRE_REGISTERED: 'PRE_REGISTERED',
  PHYSICALLY_CHECKED_IN: 'PHYSICALLY_CHECKED_IN',
  WAITING: 'WAITING',
  APPROACHING: 'APPROACHING',
  CALLED: 'CALLED',
  IN_CONSULTATION: 'IN_CONSULTATION',
  COMPLETED: 'COMPLETED',
  NO_SHOW: 'NO_SHOW',
  LEFT_QUEUE: 'LEFT_QUEUE'
};

export const TOKEN_STATUS = {
  WAITING: 'WAITING',
  CALLED: 'CALLED',
  IN_CONSULTATION: 'IN_CONSULTATION',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW'
};

export const QUEUE_TYPES = {
  VIRTUAL: 'VIRTUAL',
  PHYSICAL: 'PHYSICAL'
};

export const TOKEN_PRIORITY = {
  EMERGENCY: 0,
  PRIORITY: 1,
  NORMAL: 2
};

export const CHECKIN_METHODS = {
  DYNAMIC_QR: 'dynamic_qr',
  TOKEN_QR_SCAN: 'token_qr_scan',
  MANUAL: 'manual',
  WALKIN_QR: 'walkin_qr'
};

export const HOSPITALS = [
  {
    id: 'city-hospital',
    numeric_id: 1,
    name: 'City Hospital',
    type: 'Public Hospital',
    district: 'Central District',
    address: '1200 Health Boulevard, Central Metro',
    hours: '24/7 Emergency & Acute Care | Outpatient: 07:00 – 19:00',
    status: 'Open 24/7',
    isOpen: true,
    overallCrowd: 'Moderate',
    checkedInCount: 87,
    activeDeptsCount: 6,
    avgWait: '31 min',
    trend: 'Decreasing',
    departments: [
      {
        id: 'gen-med',
        numeric_id: 101,
        name: 'General Medicine',
        prefix: 'G',
        waitingCount: 32,
        estimatedWait: '28–35 min',
        currentServing: 'G121',
        trend: 'Decreasing',
        crowdLevel: 'Moderate',
        roomsActive: 4,
        doctorsOnDuty: 3,
        floor: 'Floor 2, Wing B',
        consultationRoom: 'Consultation Room 4',
        leadDoctor: 'Dr. Aris Vance'
      },
      {
        id: 'cardiology',
        numeric_id: 102,
        name: 'Cardiology',
        prefix: 'C',
        waitingCount: 18,
        estimatedWait: '45–55 min',
        currentServing: 'C084',
        trend: 'Increasing',
        crowdLevel: 'High',
        roomsActive: 2,
        doctorsOnDuty: 2,
        floor: 'Floor 3, Wing A',
        consultationRoom: 'Consultation Room 2',
        leadDoctor: 'Dr. Evelyn Reed'
      },
      {
        id: 'orthopedics',
        numeric_id: 103,
        name: 'Orthopedics',
        prefix: 'O',
        waitingCount: 12,
        estimatedWait: '18–25 min',
        currentServing: 'O052',
        trend: 'Steady',
        crowdLevel: 'Low',
        roomsActive: 3,
        doctorsOnDuty: 2,
        floor: 'Floor 1, Wing C',
        consultationRoom: 'Consultation Room 1',
        leadDoctor: 'Dr. Marcus Webb'
      },
      {
        id: 'pediatrics',
        numeric_id: 104,
        name: 'Pediatrics',
        prefix: 'P',
        waitingCount: 14,
        estimatedWait: '20–30 min',
        currentServing: 'P039',
        trend: 'Decreasing',
        crowdLevel: 'Low',
        roomsActive: 3,
        doctorsOnDuty: 3,
        floor: 'Floor 2, Wing A',
        consultationRoom: 'Consultation Room 5',
        leadDoctor: 'Dr. Sarah Lin'
      },
      {
        id: 'ent',
        numeric_id: 105,
        name: 'ENT (Ear, Nose & Throat)',
        prefix: 'E',
        waitingCount: 7,
        estimatedWait: '12–18 min',
        currentServing: 'E019',
        trend: 'Steady',
        crowdLevel: 'Low',
        roomsActive: 2,
        doctorsOnDuty: 1,
        floor: 'Floor 1, Wing B',
        consultationRoom: 'Consultation Room 3',
        leadDoctor: 'Dr. James Chen'
      },
      {
        id: 'dermatology',
        numeric_id: 106,
        name: 'Dermatology',
        prefix: 'D',
        waitingCount: 9,
        estimatedWait: '15–20 min',
        currentServing: 'D028',
        trend: 'Steady',
        crowdLevel: 'Low',
        roomsActive: 2,
        doctorsOnDuty: 2,
        floor: 'Floor 3, Wing C',
        consultationRoom: 'Consultation Room 6',
        leadDoctor: 'Dr. Priya Patel'
      }
    ]
  },
  {
    id: 'metro-care',
    numeric_id: 2,
    name: 'Metro Care Hospital',
    type: 'Private Hospital',
    district: 'North Hub',
    address: '450 Innovation Parkway, Northside',
    hours: 'Outpatient: 08:00 – 20:00 | Urgent Care 24/7',
    status: 'Open',
    isOpen: true,
    overallCrowd: 'Low',
    checkedInCount: 42,
    activeDeptsCount: 5,
    avgWait: '19 min',
    trend: 'Steady',
    departments: [
      {
        id: 'gen-med',
        numeric_id: 201,
        name: 'General Medicine',
        prefix: 'M',
        waitingCount: 14,
        estimatedWait: '17–22 min',
        currentServing: 'M068',
        trend: 'Steady',
        crowdLevel: 'Low',
        roomsActive: 3,
        doctorsOnDuty: 2,
        floor: 'Level 1, North',
        consultationRoom: 'Clinic Room 2',
        leadDoctor: 'Dr. Robert Torres'
      },
      {
        id: 'cardiology',
        numeric_id: 202,
        name: 'Cardiology',
        prefix: 'MC',
        waitingCount: 8,
        estimatedWait: '20–25 min',
        currentServing: 'MC031',
        trend: 'Decreasing',
        crowdLevel: 'Low',
        roomsActive: 2,
        doctorsOnDuty: 2,
        floor: 'Level 2, North',
        consultationRoom: 'Clinic Room 4',
        leadDoctor: 'Dr. Maria Santos'
      }
    ]
  },
  {
    id: 'central-hospital',
    numeric_id: 3,
    name: 'Central Hospital',
    type: 'Public Hospital',
    district: 'Central District',
    address: '88 Heritage Square, Downtown Center',
    hours: '24/7 Comprehensive Emergency & Clinical Center',
    status: 'Open 24/7',
    isOpen: true,
    overallCrowd: 'High',
    checkedInCount: 146,
    activeDeptsCount: 7,
    avgWait: '58 min',
    trend: 'Increasing',
    departments: [
      {
        id: 'gen-med',
        numeric_id: 301,
        name: 'General Medicine',
        prefix: 'C',
        waitingCount: 51,
        estimatedWait: '60–75 min',
        currentServing: 'C210',
        trend: 'Increasing',
        crowdLevel: 'High',
        roomsActive: 5,
        doctorsOnDuty: 4,
        floor: 'Main Block, Floor 1',
        consultationRoom: 'Room 102',
        leadDoctor: 'Dr. Helen Zhao'
      }
    ]
  },
  {
    id: 'apex-specialty',
    numeric_id: 4,
    name: 'Apex Specialty Hospital',
    type: 'Private Hospital',
    district: 'West Valley',
    address: '77 Silicon Way, West End Tech Hub',
    hours: 'Outpatient: 08:30 – 18:30',
    status: 'Open',
    isOpen: true,
    overallCrowd: 'Low',
    checkedInCount: 29,
    activeDeptsCount: 4,
    avgWait: '14 min',
    trend: 'Decreasing',
    departments: [
      {
        id: 'gen-med',
        numeric_id: 401,
        name: 'General Medicine',
        prefix: 'A',
        waitingCount: 9,
        estimatedWait: '12–16 min',
        currentServing: 'A045',
        trend: 'Decreasing',
        crowdLevel: 'Low',
        roomsActive: 3,
        doctorsOnDuty: 2,
        floor: 'Pavilion A',
        consultationRoom: 'Suite 3',
        leadDoctor: 'Dr. Kevin Brooks'
      }
    ]
  }
];

export function getHospital(id) {
  return HOSPITALS.find(h => h.id === id || h.numeric_id === Number(id)) || HOSPITALS[0];
}

export function getDepartment(hospitalId, deptId) {
  const hospital = getHospital(hospitalId);
  if (!hospital) return null;
  return hospital.departments.find(d => d.id === deptId || d.numeric_id === Number(deptId)) || hospital.departments[0];
}
