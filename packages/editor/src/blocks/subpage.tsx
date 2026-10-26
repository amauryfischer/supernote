// Carte de sous-page `[subpage id="…"]`. Le rendu (titre, ouverture) est
// délégué à l'hôte via un provider, comme embed ; sans hôte, repli statique.

import * as React from "react";
import { createReactBlockSpec } from "@blocknote/react";

export type SubpageRenderer = (props: { noteId: string }) => React.ReactNode;

const SubpageRendererContext = React.createContext<SubpageRenderer | null>(null);

export function SubpageProvider({
  renderer,
  children,
}: {
  renderer: SubpageRenderer | null;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <SubpageRendererContext.Provider value={renderer}>{children}</SubpageRendererContext.Provider>
  );
}

// prop noteId : NE PAS renommer, la sérialisation `[subpage id="…"]` en dépend.
export const subpageBlockSpec = createReactBlockSpec(
  {
    type: "subpage" as const,
    propSchema: {
      noteId: { default: "" },
    },
    content: "none" as const,
  },
  {
    render: ({ block }) => {
      const noteId = (block.props.noteId ?? "") as string;
      const renderer = React.useContext(SubpageRendererContext);
      return (
        <div className="sn-subpage" data-subpage-id={noteId} contentEditable={false}>
          {renderer ? renderer({ noteId }) : <div data-subpage-fallback>Page</div>}
        </div>
      );
    },
    toExternalHTML: ({ block }) => <p>{`[subpage id="${(block.props.noteId ?? "") as string}"]`}</p>,
  },
);
