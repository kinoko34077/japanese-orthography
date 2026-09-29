export type DiagnosticSeverity = 'ERROR' | 'REVIEW';

export interface Diagnostic {
  severity: DiagnosticSeverity;
  code: string;
  path?: string;
  message: string;
}
