// ============================================================
// Public API types for @supernote/import
// ============================================================

export interface ImportError {
  readonly file: string;
  readonly message: string;
  readonly cause?: unknown;
}

export interface ImportResult {
  readonly imported: {
    readonly notes: number;
    readonly contacts: number;
    readonly orgs: number;
    readonly assets: number;
  };
  readonly skipped: number;
  readonly errors: ImportError[];
  readonly warnings: string[];
}

export interface NoteRecord {
  readonly id: string;
  readonly filePath: string;
  readonly frontmatter: Record<string, unknown>;
  readonly body: string;
  readonly tags: string[];
}

export interface ContactRecord {
  readonly id: string;
  readonly filePath: string;
  readonly name: string;
  readonly emails: string[];
  readonly phones: string[];
  readonly organization?: string;
  readonly birthday?: string;
  readonly photo?: string;
  readonly noteBody: string;
}

export interface OrgRecord {
  readonly id: string;
  readonly filePath: string;
  readonly name: string;
}

export interface TransactionRecord {
  readonly id: string;
  readonly filePath: string;
  readonly date: string;
  readonly amount: number;
  readonly currency: string;
  readonly description: string;
  readonly tags: string[];
  readonly accountName?: string;
}

export interface Resolvers {
  writeNote?: (note: NoteRecord) => Promise<void>;
  writeContact?: (contact: ContactRecord) => Promise<void>;
  writeOrg?: (org: OrgRecord) => Promise<void>;
  writeTransaction?: (tx: TransactionRecord) => Promise<void>;
  writeAsset?: (filePath: string, content: Buffer) => Promise<void>;
}

export interface ImportOptions {
  readonly targetVaultRoot: string;
  readonly defaultFolder?: string;
  readonly preserveHierarchy?: boolean;
  readonly dryRun?: boolean;
  readonly resolvers: Resolvers;
}
