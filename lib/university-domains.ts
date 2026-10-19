import domainData from "@/data/us-university-domains.json";

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function emailDomain(email: string) {
  return normalizeEmail(email).split("@")[1] || "";
}

export function findUniversityDomain(email: string) {
  const domain = emailDomain(email);
  return domainData.domains.find((entry) => domain === entry.domain || domain.endsWith(`.${entry.domain}`)) || null;
}

export function isRecognizedUniversityEmail(email: string) {
  return Boolean(findUniversityDomain(email));
}
