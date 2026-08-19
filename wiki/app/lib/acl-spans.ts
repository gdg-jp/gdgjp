/**
 * Compatibility surface for the wiki. Pure ACL span operations live in gdg-lib
 * so local agents and the Worker share exactly the same implementation.
 */
export {
  ACL_REDACTION_PLACEHOLDER,
  aclSpanSourceIds,
  computeAclSourceIdsJson,
  metadataContainsAclTag,
  parseAclSpans,
  redactAclSpans,
  removeAclSpans,
  scrubResidualAclMarkup,
  stripAclSpans,
  validateAclSpans,
} from "@gdgjp/gdg-lib/acl";
export type { AclSpan } from "@gdgjp/gdg-lib/acl";
