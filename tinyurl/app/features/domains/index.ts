export type {
  Domain,
  DomainKind,
  DomainMode,
  DomainStatus,
  DnsRecord,
} from "./domain.repository";
export {
  countLinksForDomain,
  createPendingDomain,
  getDomainByHostname,
  getDomainById,
  listDomainsForChapters,
  softDeleteDomain,
  updateDomainProviderState,
} from "./domain.repository";
export type { DomainProvider, ProviderDomainState } from "./domain-provider";
export { DomainProviderHttpError, createDomainProvider } from "./domain-provider";
export { canManageChapterDomains, manageableChapterIds } from "./domain-policy";
export type { DomainServiceDependencies } from "./domain.service";
export {
  VERCEL_HOBBY_DOMAIN_LIMIT,
  normalizeApex,
  registerDomain,
  syncDomain,
} from "./domain.service";
