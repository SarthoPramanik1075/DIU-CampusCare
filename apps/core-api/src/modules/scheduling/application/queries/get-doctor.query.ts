import type { DoctorDetail, DoctorRepository } from '../doctor-repository.js';

/** `GET /api/v1/doctors/{id}` (API §3.1) — unauthenticated (matrix: `doctor-profiles` grants `ANON: read`). */
export class GetDoctorQuery {
  constructor(private readonly repository: DoctorRepository) {}

  execute(doctorId: string): Promise<DoctorDetail | null> {
    return this.repository.findDoctorDetailById(doctorId);
  }
}
