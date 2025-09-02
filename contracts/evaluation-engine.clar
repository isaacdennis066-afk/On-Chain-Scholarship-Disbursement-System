;; EvaluationEngine.clar
;; Core contract for evaluating scholarship applications against criteria
;; Handles automated verification of academic achievements on-chain
;; Integrates with other contracts like AchievementVerifier and StudentRegistry

;; Constants
(define-constant ERR_UNAUTHORIZED u100)
(define-constant ERR_INVALID_SCHOLARSHIP u101)
(define-constant ERR_INVALID_APPLICATION u102)
(define-constant ERR_INVALID_CRITERIA u103)
(define-constant ERR_EVALUATION_FAILED u104)
(define-constant ERR_ALREADY_EVALUATED u105)
(define-constant ERR_INSUFFICIENT_ACHIEVEMENTS u106)
(define-constant ERR_CRITERIA_NOT_MET u107)
(define-constant ERR_INVALID_WEIGHT u108)
(define-constant ERR_PAUSED u109)
(define-constant ERR_INVALID_GPA u110)
(define-constant ERR_INVALID_COURSE u111)
(define-constant ERR_DUPLICATE_CRITERIA u112)
(define-constant ERR_NO_ACHIEVEMENTS u113)
(define-constant ERR_TIMESTAMP_MISMATCH u114)
(define-constant ERR_INVALID_STATUS u115)

(define-constant STATUS_PENDING u0)
(define-constant STATUS_APPROVED u1)
(define-constant STATUS_REJECTED u2)

(define-constant MAX_CRITERIA_ITEMS u20)
(define-constant MAX_WEIGHT u100)
(define-constant GPA_SCALE u400) ;; Assuming 4.0 scale * 100 for precision

;; Data Maps
(define-map scholarships
  { scholarship-id: uint }
  {
    creator: principal,
    gpa-threshold: uint, ;; e.g., 350 for 3.5
    required-courses: (list 20 (string-ascii 50)),
    required-credits: uint,
    extracurricular-weight: uint, ;; Percentage weight
    essay-required: bool,
    min-attendance: uint, ;; Percentage
    custom-criteria: (list 10 { key: (string-ascii 32), value: uint }),
    total-weight: uint,
    active: bool,
    paused: bool
  }
)

(define-map applications
  { application-id: uint }
  {
    student: principal,
    scholarship-id: uint,
    status: uint,
    evaluation-timestamp: uint,
    score: uint,
    verified-achievements: (list 20 { type: (string-ascii 32), value: uint, verified: bool }),
    essay-hash: (optional (buff 32)),
    attendance-percentage: uint
  }
)

(define-map evaluation-logs
  { application-id: uint, log-id: uint }
  {
    timestamp: uint,
    message: (string-utf8 256),
    evaluator: principal
  }
)

(define-map application-counters
  { scholarship-id: uint }
  { count: uint }
)

;; Private Variables (using maps for simulation)
(define-map contract-state
  { key: (string-ascii 32) }
  { value: bool }
)
;; e.g., {key: "paused"} -> paused status

;; Traits (for integration with other contracts)
(define-trait achievement-verifier-trait
  (
    (verify-achievement (principal uint (string-ascii 32)) (response bool uint))
  )
)

(define-trait student-registry-trait
  (
    (get-student-profile (principal) (response { gpa: uint, courses: (list 20 (string-ascii 50)), credits: uint } uint))
  )
)

;; Assuming these are deployed separately
(define-data-var verifier-contract principal 'SP000000000000000000002Q6VF78.achievement-verifier)
(define-data-var registry-contract principal 'SP000000000000000000002Q6VF78.student-registry)

;; Public Functions

(define-public (create-scholarship 
  (gpa-threshold uint)
  (required-courses (list 20 (string-ascii 50)))
  (required-credits uint)
  (extracurricular-weight uint)
  (essay-required bool)
  (min-attendance uint)
  (custom-criteria (list 10 { key: (string-ascii 32), value: uint }))
)
  (let
    (
      (scholarship-id (+ (unwrap-panic (map-get? application-counters {scholarship-id: u0})) u1))
      (total-w (fold calculate-total-weight custom-criteria extracurricular-weight))
    )
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR_UNAUTHORIZED))
    (asserts! (<= gpa-threshold GPA_SCALE) (err ERR_INVALID_GPA))
    (asserts! (<= (len required-courses) MAX_CRITERIA_ITEMS) (err ERR_INVALID_CRITERIA))
    (asserts! (<= extracurricular-weight MAX_WEIGHT) (err ERR_INVALID_WEIGHT))
    (asserts! (<= min-attendance u100) (err ERR_INVALID_CRITERIA))
    (asserts! (not (map-get? scholarships {scholarship-id: scholarship-id})) (err ERR_DUPLICATE_CRITERIA))
    (asserts! (is-eq total-w u100) (err ERR_INVALID_WEIGHT)) ;; Changed == to is-eq
    
    ;; Additional validation for required-credits
    (asserts! (> required-credits u0) (err ERR_INVALID_CRITERIA))
    
    (map-set scholarships
      { scholarship-id: scholarship-id }
      {
        creator: tx-sender,
        gpa-threshold: gpa-threshold,
        required-courses: required-courses,
        required-credits: required-credits,
        extracurricular-weight: extracurricular-weight,
        essay-required: essay-required,
        min-attendance: min-attendance,
        custom-criteria: custom-criteria,
        total-weight: total-w,
        active: true,
        paused: false
      }
    )
    (map-set application-counters {scholarship-id: scholarship-id} {count: u0})
    (ok scholarship-id)
  )
)

(define-public (submit-application 
  (scholarship-id uint)
  (essay-hash (optional (buff 32)))
  (attendance-percentage uint)
)
  (let
    (
      (application-id (fold get-next-app-id scholarship-id u1))
      (scholarship (unwrap! (map-get? scholarships {scholarship-id: scholarship-id}) (err ERR_INVALID_SCHOLARSHIP)))
    )
    (asserts! (get active scholarship) (err ERR_INVALID_SCHOLARSHIP))
    (asserts! (not (get paused scholarship)) (err ERR_PAUSED))
    (asserts! (<= attendance-percentage u100) (err ERR_INVALID_CRITERIA))
    (if (get essay-required scholarship)
      (asserts! (is-some essay-hash) (err ERR_INVALID_APPLICATION))
      true
    )
    
    (map-set applications
      { application-id: application-id }
      {
        student: tx-sender,
        scholarship-id: scholarship-id,
        status: STATUS_PENDING,
        evaluation-timestamp: u0,
        score: u0,
        verified-achievements: (list),
        essay-hash: essay-hash,
        attendance-percentage: attendance-percentage
      }
    )
    (ok application-id)
  )
)

(define-public (evaluate-application (application-id uint))
  (let
    (
      (app (unwrap! (map-get? applications {application-id: application-id}) (err ERR_INVALID_APPLICATION)))
      (scholarship (unwrap! (map-get? scholarships {scholarship-id: (get scholarship-id app)}) (err ERR_INVALID_SCHOLARSHIP)))
      (student-profile (try! (contract-call? (as-contract (var-get registry-contract)) get-student-profile (get student app))))
      (verified-achs (try! (verify-achievements (get student app) (get gpa student-profile) (get courses student-profile))))
      (gpa-score (if (>= (get gpa student-profile) (get gpa-threshold scholarship)) u100 u0))
      (courses-met (fold check-courses (get required-courses scholarship) (get courses student-profile)))
      (credits-met (>= (get credits student-profile) (get required-credits scholarship)))
      (attendance-met (>= (get attendance-percentage app) (get min-attendance scholarship)))
      (extra-score (calculate-extra-weight (get extracurricular-weight scholarship) verified-achs))
      (custom-score (fold calculate-custom-score (get custom-criteria scholarship) verified-achs))
      (total-score (+ gpa-score (if courses-met u100 u0) (if credits-met u100 u0) (if attendance-met u100 u0) extra-score custom-score))
      (passing-score (* (get total-weight scholarship) u80 / u100)) ;; 80% threshold
    )
    (asserts! (is-eq (get status app) STATUS_PENDING) (err ERR_ALREADY_EVALUATED))
    (asserts! (not (get paused (map-get? contract-state {key: "paused"}))) (err ERR_PAUSED))
    
    (if (>= total-score passing-score)
      (begin
        (map-set applications {application-id: application-id} (merge app {status: STATUS_APPROVED, score: total-score, evaluation-timestamp: block-height, verified-achievements: verified-achs}))
        (log-evaluation application-id "Application approved" tx-sender)
        (ok STATUS_APPROVED)
      )
      (begin
        (map-set applications {application-id: application-id} (merge app {status: STATUS_REJECTED, score: total-score, evaluation-timestamp: block-height, verified-achievements: verified-achs}))
        (log-evaluation application-id "Application rejected: criteria not met" tx-sender)
        (err ERR_CRITERIA_NOT_MET)
      )
    )
  )
)

;; Read-only Functions

(define-read-only (get-application-status (application-id uint))
  (match (map-get? applications {application-id: application-id})
    app (ok (get status app))
    (err ERR_INVALID_APPLICATION)
  )
)

(define-read-only (get-scholarship-details (scholarship-id uint))
  (map-get? scholarships {scholarship-id: scholarship-id})
)

(define-read-only (get-evaluation-log (application-id uint) (log-id uint))
  (map-get? evaluation-logs {application-id: application-id, log-id: log-id})
)

;; Private Functions

(define-private (calculate-total-weight (item {key: (string-ascii 32), value: uint}) (acc uint))
  (+ acc (get value item))
)

(define-private (get-next-app-id (sid uint) (acc uint))
  (+ (unwrap-panic (get count (map-get? application-counters {scholarship-id: sid}))) u1)
)

(define-private (check-courses (req (string-ascii 50)) (student-courses (list 20 (string-ascii 50))))
  (is-some (index-of student-courses req))
)

(define-private (calculate-extra-weight (weight uint) (achs (list 20 {type: (string-ascii 32), value: uint, verified: bool})))
  (* weight (len (filter verified-ach achs)) / MAX_CRITERIA_ITEMS)
)

(define-private (calculate-custom-score (crit {key: (string-ascii 32), value: uint}) (achs (list 20 {type: (string-ascii 32), value: uint, verified: bool})))
  (let ((matched (filter (lambda (a) (is-eq (get type a) (get key crit))) achs)))
    (if (> (len matched) u0)
      (get value crit)
      u0
    ))
)

(define-private (verified-ach (ach {type: (string-ascii 32), value: uint, verified: bool}))
  (get verified ach)
)

(define-private (verify-achievements (student principal) (gpa uint) (courses (list 20 (string-ascii 50))))
  (let ((verif (contract-call? (as-contract (var-get verifier-contract)) verify-achievement student gpa "gpa")))
    ;; Mock multiple verifications
    (list {type: "gpa", value: gpa, verified: (is-ok verif)} )
  )
)

(define-private (log-evaluation (app-id uint) (msg (string-utf8 256)) (eval principal))
  (let ((log-id (+ (len (map-get? evaluation-logs {application-id: app-id})) u1))) ;; Simplified
    (map-set evaluation-logs {application-id: app-id, log-id: log-id} {timestamp: block-height, message: msg, evaluator: eval})
  )
)

;; Admin Functions
(define-data-var contract-admin principal tx-sender)

(define-public (pause-engine)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR_UNAUTHORIZED))
    (map-set contract-state {key: "paused"} {value: true})
    (ok true)
  )
)

(define-public (unpause-engine)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR_UNAUTHORIZED))
    (map-set contract-state {key: "paused"} {value: false})
    (ok true)
  )
)

(define-public (update-verifier (new-verifier principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR_UNAUTHORIZED))
    (var-set verifier-contract new-verifier)
    (ok true)
  )
)

(define-public (update-registry (new-registry principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-admin)) (err ERR_UNAUTHORIZED))
    (var-set registry-contract new-registry)
    (ok true)
  )
)

(define-public (deactivate-scholarship (scholarship-id uint))
  (let ((scholarship (unwrap! (map-get? scholarships {scholarship-id: scholarship-id}) (err ERR_INVALID_SCHOLARSHIP))))
    (asserts! (is-eq tx-sender (get creator scholarship)) (err ERR_UNAUTHORIZED))
    (map-set scholarships {scholarship-id: scholarship-id} (merge scholarship {active: false}))
    (ok true)
  )
)