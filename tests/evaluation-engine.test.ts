import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface Scholarship {
  creator: string;
  gpaThreshold: number;
  requiredCourses: string[];
  requiredCredits: number;
  extracurricularWeight: number;
  essayRequired: boolean;
  minAttendance: number;
  customCriteria: { key: string; value: number }[];
  totalWeight: number;
  active: boolean;
  paused: boolean;
}

interface Application {
  student: string;
  scholarshipId: number;
  status: number;
  evaluationTimestamp: number;
  score: number;
  verifiedAchievements: { type: string; value: number; verified: boolean }[];
  essayHash?: string;
  attendancePercentage: number;
}

interface EvaluationLog {
  timestamp: number;
  message: string;
  evaluator: string;
}

interface ContractState {
  scholarships: Map<number, Scholarship>;
  applications: Map<number, Application>;
  evaluationLogs: Map<string, EvaluationLog>; // Key as `${appId}-${logId}`
  applicationCounters: Map<number, number>; // scholarshipId -> count
  paused: boolean;
  admin: string;
  verifierContract: string;
  registryContract: string;
  scholarshipCounter: number;
}

// Mock contract implementation
class EvaluationEngineMock {
  private state: ContractState = {
    scholarships: new Map(),
    applications: new Map(),
    evaluationLogs: new Map(),
    applicationCounters: new Map(),
    paused: false,
    admin: "deployer",
    verifierContract: "mock-verifier",
    registryContract: "mock-registry",
    scholarshipCounter: 0,
  };

  private ERR_UNAUTHORIZED = 100;
  private ERR_INVALID_SCHOLARSHIP = 101;
  private ERR_INVALID_APPLICATION = 102;
  private ERR_INVALID_CRITERIA = 103;
  private ERR_ALREADY_EVALUATED = 105;
  private ERR_CRITERIA_NOT_MET = 107;
  private ERR_INVALID_WEIGHT = 108;
  private ERR_PAUSED = 109;
  private ERR_INVALID_GPA = 110;
  private ERR_DUPLICATE_CRITERIA = 112;
  private STATUS_PENDING = 0;
  private STATUS_APPROVED = 1;
  private STATUS_REJECTED = 2;
  private GPA_SCALE = 400;
  private MAX_CRITERIA_ITEMS = 20;
  private MAX_WEIGHT = 100;

  // Mock external calls
  private mockStudentProfiles: Map<string, { gpa: number; courses: string[]; credits: number }> = new Map();
  private mockVerifications: Map<string, boolean> = new Map(); // student-gpa -> verified

  setMockStudentProfile(student: string, profile: { gpa: number; courses: string[]; credits: number }) {
    this.mockStudentProfiles.set(student, profile);
  }

  setMockVerification(student: string, gpa: number, verified: boolean) {
    this.mockVerifications.set(`${student}-${gpa}`, verified);
  }

  createScholarship(
    caller: string,
    gpaThreshold: number,
    requiredCourses: string[],
    requiredCredits: number,
    extracurricularWeight: number,
    essayRequired: boolean,
    minAttendance: number,
    customCriteria: { key: string; value: number }[]
  ): ClarityResponse<number> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (gpaThreshold > this.GPA_SCALE) {
      return { ok: false, value: this.ERR_INVALID_GPA };
    }
    if (requiredCourses.length > this.MAX_CRITERIA_ITEMS) {
      return { ok: false, value: this.ERR_INVALID_CRITERIA };
    }
    if (extracurricularWeight > this.MAX_WEIGHT) {
      return { ok: false, value: this.ERR_INVALID_WEIGHT };
    }
    if (minAttendance > 100) {
      return { ok: false, value: this.ERR_INVALID_CRITERIA };
    }
    const totalWeight = customCriteria.reduce((acc, item) => acc + item.value, extracurricularWeight);
    if (totalWeight !== 100) {
      return { ok: false, value: this.ERR_INVALID_WEIGHT };
    }

    const scholarshipId = ++this.state.scholarshipCounter;
    this.state.scholarships.set(scholarshipId, {
      creator: caller,
      gpaThreshold,
      requiredCourses,
      requiredCredits,
      extracurricularWeight,
      essayRequired,
      minAttendance,
      customCriteria,
      totalWeight,
      active: true,
      paused: false,
    });
    this.state.applicationCounters.set(scholarshipId, 0);
    return { ok: true, value: scholarshipId };
  }

  submitApplication(
    caller: string,
    scholarshipId: number,
    essayHash?: string,
    attendancePercentage: number
  ): ClarityResponse<number> {
    const scholarship = this.state.scholarships.get(scholarshipId);
    if (!scholarship || !scholarship.active || scholarship.paused) {
      return { ok: false, value: this.ERR_INVALID_SCHOLARSHIP };
    }
    if (attendancePercentage > 100) {
      return { ok: false, value: this.ERR_INVALID_CRITERIA };
    }
    if (scholarship.essayRequired && !essayHash) {
      return { ok: false, value: this.ERR_INVALID_APPLICATION };
    }

    let count = this.state.applicationCounters.get(scholarshipId) || 0;
    const applicationId = ++count;
    this.state.applicationCounters.set(scholarshipId, applicationId);
    this.state.applications.set(applicationId, {
      student: caller,
      scholarshipId,
      status: this.STATUS_PENDING,
      evaluationTimestamp: 0,
      score: 0,
      verifiedAchievements: [],
      essayHash,
      attendancePercentage,
    });
    return { ok: true, value: applicationId };
  }

  evaluateApplication(applicationId: number): ClarityResponse<number> {
    const app = this.state.applications.get(applicationId);
    if (!app) {
      return { ok: false, value: this.ERR_INVALID_APPLICATION };
    }
    if (app.status !== this.STATUS_PENDING) {
      return { ok: false, value: this.ERR_ALREADY_EVALUATED };
    }
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const scholarship = this.state.scholarships.get(app.scholarshipId)!;
    const profile = this.mockStudentProfiles.get(app.student);
    if (!profile) {
      return { ok: false, value: this.ERR_INVALID_APPLICATION };
    }
    const verified = this.mockVerifications.get(`${app.student}-${profile.gpa}`) ?? false;
    const verifiedAchievements = [{ type: "gpa", value: profile.gpa, verified }];
    
    const gpaScore = profile.gpa >= scholarship.gpaThreshold ? 100 : 0;
    const coursesMet = scholarship.requiredCourses.every(req => profile.courses.includes(req));
    const creditsMet = profile.credits >= scholarship.requiredCredits;
    const attendanceMet = app.attendancePercentage >= scholarship.minAttendance;
    const extraScore = (scholarship.extracurricularWeight * verifiedAchievements.filter(a => a.verified).length) / this.MAX_CRITERIA_ITEMS;
    const customScore = scholarship.customCriteria.reduce((acc, crit) => {
      const matched = verifiedAchievements.find(a => a.type === crit.key);
      return acc + (matched ? crit.value : 0);
    }, 0);
    const totalScore = gpaScore + (coursesMet ? 100 : 0) + (creditsMet ? 100 : 0) + (attendanceMet ? 100 : 0) + extraScore + customScore;
    const passingScore = (scholarship.totalWeight * 80) / 100;

    const status = totalScore >= passingScore ? this.STATUS_APPROVED : this.STATUS_REJECTED;
    this.state.applications.set(applicationId, { ...app, status, score: totalScore, evaluationTimestamp: Date.now(), verifiedAchievements });
    
    // Log
    const logId = this.state.evaluationLogs.size + 1;
    this.state.evaluationLogs.set(`${applicationId}-${logId}`, {
      timestamp: Date.now(),
      message: status === this.STATUS_APPROVED ? "Application approved" : "Application rejected: criteria not met",
      evaluator: "system",
    });

    return status === this.STATUS_APPROVED ? { ok: true, value: status } : { ok: false, value: this.ERR_CRITERIA_NOT_MET };
  }

  getApplicationStatus(applicationId: number): ClarityResponse<number> {
    const app = this.state.applications.get(applicationId);
    return app ? { ok: true, value: app.status } : { ok: false, value: this.ERR_INVALID_APPLICATION };
  }

  getScholarshipDetails(scholarshipId: number): ClarityResponse<Scholarship | null> {
    return { ok: true, value: this.state.scholarships.get(scholarshipId) ?? null };
  }

  pauseEngine(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpauseEngine(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  deactivateScholarship(caller: string, scholarshipId: number): ClarityResponse<boolean> {
    const scholarship = this.state.scholarships.get(scholarshipId);
    if (!scholarship || caller !== scholarship.creator) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    scholarship.active = false;
    this.state.scholarships.set(scholarshipId, scholarship);
    return { ok: true, value: true };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  student1: "student_1",
  student2: "student_2",
};

describe("EvaluationEngine Contract", () => {
  let contract: EvaluationEngineMock;

  beforeEach(() => {
    contract = new EvaluationEngineMock();
  });

  it("should allow admin to create a scholarship", () => {
    const result = contract.createScholarship(
      accounts.deployer,
      350,
      ["Math101", "Science201"],
      120,
      20,
      true,
      90,
      [{ key: "leadership", value: 30 }, { key: "volunteer", value: 50 }]
    );
    expect(result).toEqual({ ok: true, value: 1 });

    const details = contract.getScholarshipDetails(1);
    expect(details.ok).toBe(true);
    expect(details.value).toMatchObject({
      gpaThreshold: 350,
      requiredCourses: ["Math101", "Science201"],
      extracurricularWeight: 20,
      totalWeight: 100,
      active: true,
    });
  });

  it("should prevent non-admin from creating scholarship", () => {
    const result = contract.createScholarship(
      accounts.student1,
      350,
      ["Math101"],
      120,
      20,
      true,
      90,
      [{ key: "leadership", value: 80 }]
    );
    expect(result).toEqual({ ok: false, value: 100 });
  });

  it("should allow student to submit application", () => {
    contract.createScholarship(
      accounts.deployer,
      350,
      ["Math101"],
      120,
      20,
      true,
      90,
      [{ key: "leadership", value: 80 }]
    );

    const result = contract.submitApplication(accounts.student1, 1, "essayhash", 95);
    expect(result).toEqual({ ok: true, value: 1 });
  });

  it("should evaluate application successfully", () => {
    contract.createScholarship(
      accounts.deployer,
      350,
      ["Math101"],
      120,
      20,
      true,
      90,
      [{ key: "leadership", value: 80 }]
    );
    contract.submitApplication(accounts.student1, 1, "essayhash", 95);
    contract.setMockStudentProfile(accounts.student1, { gpa: 360, courses: ["Math101"], credits: 130 });
    contract.setMockVerification(accounts.student1, 360, true);

    const result = contract.evaluateApplication(1);
    expect(result).toEqual({ ok: true, value: 1 });

    const status = contract.getApplicationStatus(1);
    expect(status).toEqual({ ok: true, value: 1 });
  });

  it("should prevent evaluation when paused", () => {
    contract.createScholarship(accounts.deployer, 350, ["Math101"], 120, 20, true, 90, [{ key: "leadership", value: 80 }]);
    contract.submitApplication(accounts.student1, 1, "essayhash", 95);
    contract.pauseEngine(accounts.deployer);

    const result = contract.evaluateApplication(1);
    expect(result).toEqual({ ok: false, value: 109 });
  });

  it("should allow admin to deactivate scholarship", () => {
    contract.createScholarship(accounts.deployer, 350, ["Math101"], 120, 20, true, 90, [{ key: "leadership", value: 80 }]);
    const result = contract.deactivateScholarship(accounts.deployer, 1);
    expect(result).toEqual({ ok: true, value: true });

    const details = contract.getScholarshipDetails(1);
    expect(details.value?.active).toBe(false);
  });

  it("should prevent non-creator from deactivating scholarship", () => {
    contract.createScholarship(accounts.deployer, 350, ["Math101"], 120, 20, true, 90, [{ key: "leadership", value: 80 }]);
    const result = contract.deactivateScholarship(accounts.student1, 1);
    expect(result).toEqual({ ok: false, value: 100 });
  });
});