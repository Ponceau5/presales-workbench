import { roles, type Role } from "@/lib/workspace";
export const demoPassword = "demo2026";
const usernames = [
  "sales",
  "solution",
  "hardware",
  "software",
  "commercial",
  "finance",
  "logistics",
  "dev",
  "legal",
  "pm",
];
export const accounts = roles.map((role, index) => ({
  id: usernames[index],
  name: role + "演示账号",
  role,
}));
export function authenticate(username: string, password: string) {
  return password === demoPassword
    ? accounts.find((a) => a.id === username.trim())
    : undefined;
}
export function stagePermission(role: Role, stage: string) {
  return stageReviewers[stage]?.includes(role) || false;
}
export const stageRowOwners: Record<string, Role[]> = {
  F1: ["销售", "商务支持"],
  F2: ["解决方案", "软件产品"],
  F3: ["解决方案", "解决方案"],
  F4: ["硬件产品", "硬件产品"],
  F6: ["货运关务", "认证 / 法务"],
  F7: ["销售", "财务 / 风控"],
  F8: ["解决方案", "销售"],
  F9: ["商务支持", "财务 / 风控"],
  F10: ["商务支持", "销售"],
  F11: ["商务支持", "销售"],
  F12: ["认证 / 法务", "财务 / 风控"],
  F13: ["财务 / 风控", "财务 / 风控"],
};
export function stageRowOwner(stage: string, index = 0) {
  return stageRowOwners[stage]?.[index];
}
export function canEditStageRow(role: Role, stage: string, index = 0) {
  return stageRowOwner(stage, index) === role;
}
export const stageReviewers: Record<string, Role[]> = {
  F1: ["销售", "商务支持"],
  F2: ["软件产品", "解决方案"],
  F3: ["解决方案"],
  F4: ["硬件产品"],
  F6: ["货运关务", "认证 / 法务"],
  F7: ["销售", "财务 / 风控"],
  F8: ["销售", "解决方案"],
  F9: ["商务支持", "财务 / 风控"],
  F10: ["销售", "商务支持"],
  F11: ["销售", "商务支持"],
  F12: ["财务 / 风控", "认证 / 法务"],
  F13: ["财务 / 风控"],
};
export function canReviewStage(role: Role, stage: string) {
  return stageReviewers[stage]?.includes(role) || false;
}
export function canCreateProject(role: Role) {
  return ["销售", "商务支持", "PM / PO"].includes(role);
}
export function canManageConnection(role: Role) {
  return role === "PM / PO";
}
export function canPublishSoftware(role: Role) {
  return role === "软件产品" || role === "PM / PO";
}
