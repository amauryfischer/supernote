# IPC — Communication renderer ↔ main

Supernote utilise **tRPC over Electron IPC** pour toute la communication entre le renderer (React/Next.js) et le main process (Electron/Node.js). La communication est type-safe end-to-end via les contrats définis dans `@supernote/ipc`.

---

## Architecture

```
Renderer                          Main
  │                                 │
  │  trpc.entities.save(input)      │
  ├────────── contextBridge ───────►│
  │                                 │  handler(input: z.infer<Input>)
  │                                 │  → Result<Entity, SaveError>
  ◄────────── contextBridge ────────┤
  │  Result<Entity, SaveError>      │
```

Le pont est exposé via `contextBridge.exposeInMainWorld('supernote', ...)` dans `apps/desktop/src/preload.ts`.

---

## Structure des routers

```
packages/ipc/src/
├── routers/
│   ├── entities.ts       # CRUD entités
│   ├── entity-types.ts   # gestion des schémas
│   ├── relations.ts      # création/suppression de RelationEdge
│   ├── search.ts         # FTS + sémantique
│   ├── views.ts          # vues sauvegardées
│   ├── automations.ts    # routines et automations
│   ├── git.ts            # historique, restore, sync remote
│   ├── vault.ts          # gestion du vault (multi-vault)
│   ├── settings.ts       # settings k/v
│   ├── finance.ts        # prix live, snapshots
│   ├── plugins.ts        # installation, activation
│   └── ai.ts             # auto-tag, RAG, transcription
├── root-router.ts        # merge de tous les routers
├── result.ts             # type Result<T, E>
└── index.ts
```

---

## Type Result<T, E>

Toutes les mutations et queries qui peuvent échouer retournent `Result<T, E>` :

```typescript
// packages/ipc/src/result.ts
export type Result<T, E = string> =
  | { ok: true; data: T }
  | { ok: false; error: E };

export function ok<T>(data: T): Result<T, never> {
  return { ok: true, data };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}
```

Utilisation dans le renderer :

```typescript
const result = await trpc.entities.save.mutate({ ... });
if (!result.ok) {
  toast.error(result.error.message);
  return;
}
const entity = result.data; // typé
```

---

## Exemple : procédure existante

```typescript
// packages/ipc/src/routers/entities.ts
import { z } from 'zod';
import { router, procedure } from '../trpc.js';
import { ok, err } from '../result.js';

const SaveEntityInput = z.object({
  id: z.string().optional(),           // undefined = création
  typeId: z.string(),
  fields: z.record(z.unknown()),
  body: z.string().max(1_000_000),
  filePath: z.string().optional(),     // override du path par défaut
});

export const entitiesRouter = router({
  save: procedure
    .input(SaveEntityInput)
    .mutation(async ({ input, ctx }) => {
      // ctx.services est injecté par le main process
      try {
        const entity = await ctx.services.entityService.save(input);
        return ok(entity);
      } catch (e) {
        return err({ code: 'SAVE_FAILED', message: String(e) });
      }
    }),

  get: procedure
    .input(z.object({ id: z.string() }))
    .query(async ({ input, ctx }) => {
      const entity = await ctx.services.entityService.getById(input.id);
      if (!entity) return err({ code: 'NOT_FOUND' });
      return ok(entity);
    }),

  query: procedure
    .input(z.object({
      type: z.string().optional(),
      filter: z.string().optional(),   // query language DSL
      sort: z.object({
        field: z.string(),
        direction: z.enum(['asc', 'desc']),
      }).optional(),
      limit: z.number().min(1).max(1000).default(50),
      offset: z.number().default(0),
    }))
    .query(async ({ input, ctx }) => {
      const result = await ctx.services.queryService.execute(input);
      return ok(result);
    }),
});
```

---

## Ajouter une nouvelle procédure

### 1. Définir dans le router

```typescript
// packages/ipc/src/routers/entities.ts — dans entitiesRouter

archive: procedure
  .input(z.object({
    id: z.string(),
    reason: z.string().optional(),
  }))
  .mutation(async ({ input, ctx }) => {
    const result = await ctx.services.entityService.archive(
      input.id,
      input.reason,
    );
    return result ? ok(result) : err({ code: 'ARCHIVE_FAILED' });
  }),
```

### 2. Implémenter le handler dans le main process

```typescript
// apps/desktop/src/services/entity-service.ts

async archive(id: string, reason?: string): Promise<Entity | null> {
  const entity = await this.db.entity.findUnique({ where: { id } });
  if (!entity) return null;

  const updated = await this.db.entity.update({
    where: { id },
    data: {
      fields: { ...entity.fields, status: 'archived', archive_reason: reason },
      updatedAt: new Date(),
    },
  });

  await this.fileIO.writeEntity(updated);   // persiste sur disque
  await this.pipeline.run(updated);         // reindex, etc.
  return updated;
}
```

### 3. Utiliser dans le renderer

```typescript
// apps/web/src/features/entities/use-archive.ts
import { trpc } from '@/lib/trpc.js';

export function useArchive() {
  const mutation = trpc.entities.archive.useMutation();

  return async (id: string, reason?: string) => {
    const result = await mutation.mutateAsync({ id, reason });
    if (!result.ok) throw new Error(result.error.code);
    return result.data;
  };
}
```

---

## Subscriptions (événements temps réel)

Pour les données qui changent en arrière-plan (indexation, changements externes), Supernote utilise des subscriptions tRPC :

```typescript
// packages/ipc/src/routers/entities.ts

onEntityChanged: procedure
  .input(z.object({ id: z.string().optional() }))
  .subscription(({ input, ctx }) => {
    return observable<Entity>((emit) => {
      const handler = (entity: Entity) => {
        if (!input.id || entity.id === input.id) {
          emit.next(entity);
        }
      };
      ctx.eventBus.on('entity.updated', handler);
      return () => ctx.eventBus.off('entity.updated', handler);
    });
  }),
```

Utilisation dans le renderer :

```typescript
trpc.entities.onEntityChanged.useSubscription(
  { id: entityId },
  { onData: (entity) => queryClient.setQueryData(['entity', entityId], entity) },
);
```

---

## Buffering des événements

Pour éviter les re-renders excessifs lors d'imports ou de reindexations, les événements sont accumulés et flushés dans un `requestAnimationFrame` (pattern AnyType) :

```typescript
// apps/desktop/src/ipc/event-buffer.ts
class EventBuffer {
  private buffer: Map<string, Entity> = new Map();
  private rafId: number | null = null;

  push(entity: Entity) {
    this.buffer.set(entity.id, entity);
    if (!this.rafId) {
      this.rafId = requestAnimationFrame(() => this.flush());
    }
  }

  private flush() {
    for (const entity of this.buffer.values()) {
      this.emit('entity.updated', entity);
    }
    this.buffer.clear();
    this.rafId = null;
  }
}
```

---

## Types partagés

Les types des entités retournées par l'IPC sont définis dans `@supernote/core` et partagés entre renderer et main :

```typescript
// packages/core/src/types/entity.ts
export interface Entity {
  id: string;
  typeId: string;
  typeName: string;
  filePath: string;
  fields: Record<string, unknown>;
  body: string;
  tags: string[];
  createdAt: string;     // ISO string (SQLite ne supporte pas Date nativement)
  updatedAt: string;
}
```

Jamais de `Date` dans les types IPC — sérialiser en ISO string, désérialiser dans le renderer.
