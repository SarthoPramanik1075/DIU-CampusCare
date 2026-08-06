/**
 * The ownership port — ARCHITECTURE §8.1's "Ownership Evaluator".
 *
 * The kernel decides *whether a scope:'own' rule is satisfied* by calling
 * this; it never decides *what "own" means* for a given resource, because
 * that requires domain knowledge (does the subject's id match
 * `appointment.student_id`? Is the subject's account linked to this
 * `doctor.user_account_id`?) that only the owning module has, and DR-1
 * forbids the kernel from importing anything that would tell it.
 *
 * The calling module supplies this as a lazily-evaluated thunk so that a
 * request denied for an unrelated reason (e.g. the account is suspended)
 * never pays for a database round trip to check ownership it will not use.
 */
export type OwnershipEvaluator = () => Promise<boolean> | boolean;
