import {
  canClassesAccessSourceInChannel,
  canClassesSeePageInChannel,
} from "@gdgjp/gdg-lib/acl/agent";
import type { PermissionClass, SourceAudienceKey } from "@gdgjp/gdg-lib/acl/agent";

import type { ChunkMetadata, PageMetadata, SourceMetadata } from "./frontmatter.ts";

export type SearchPrincipal = { classes: PermissionClass[]; channelAudience: SourceAudienceKey };

function isPage(subject: SourceMetadata | PageMetadata): subject is PageMetadata {
  return "access" in subject;
}

export function canSearchChunk(
  metadata: ChunkMetadata,
  sources: ReadonlyMap<string, SourceMetadata>,
  principal: SearchPrincipal,
): boolean {
  const visible = isPage(metadata.subject)
    ? canClassesSeePageInChannel(metadata.subject, principal.classes, principal.channelAudience)
    : canClassesAccessSourceInChannel(
        metadata.subject,
        principal.classes,
        principal.channelAudience,
      );
  return (
    visible &&
    metadata.aclSourceIds.every((id) => {
      const source = sources.get(id);
      return Boolean(
        source &&
          canClassesAccessSourceInChannel(source, principal.classes, principal.channelAudience),
      );
    })
  );
}
