import type { MetadataService } from '../platform/metadata.ts';
import type { Principal } from '../platform/principal.ts';
import type { RecordService } from '../platform/records.ts';

export interface OrgNode {
  id: string;
  name: string;
  title: string | null;
  department: string | null;
  managerId: string | null;
  status: string | null;
  directReports: number;
}

export class HrService {
  private metadata: MetadataService;
  private records: RecordService;

  constructor(metadata: MetadataService, records: RecordService) {
    this.metadata = metadata;
    this.records = records;
  }

  /** Flat list of employees with manager links; the client builds the tree (cycles are prevented on save). */
  async orgChart(principal: Principal): Promise<OrgNode[]> {
    this.metadata.require('employee');
    const nodes: OrgNode[] = [];
    let refs: Record<string, { name: string }> = {};
    for (let page = 1; page <= 10; page++) {
      const res = await this.records.query(principal, 'employee', { page, pageSize: 500, sort: { field: 'name', dir: 'asc' } });
      refs = { ...refs, ...res.refs };
      for (const r of res.records) {
        nodes.push({
          id: r.id,
          name: r.name,
          title: (r.fields.job_title as string | undefined) ?? null,
          department: typeof r.fields.department === 'string' ? (res.refs[r.fields.department]?.name ?? null) : null,
          managerId: (r.fields.manager as string | undefined) ?? null,
          status: (r.fields.status as string | undefined) ?? null,
          directReports: 0,
        });
      }
      if (page * 500 >= res.total) break;
    }
    const ids = new Set(nodes.map((n) => n.id));
    for (const n of nodes) {
      if (n.managerId && !ids.has(n.managerId)) n.managerId = null;
    }
    for (const n of nodes) if (n.managerId) nodes.find((m) => m.id === n.managerId)!.directReports++;
    return nodes;
  }
}
