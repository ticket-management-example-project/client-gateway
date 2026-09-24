/** Wire shape client-gateway emits over WebSocket, and the Console's hook
 * (`console/src/hooks/use-organization-provisioning.ts`) consumes. Mirrors
 * `infra-microservice`'s `ProvisioningReadModel` (the `get_provisioning_status`
 * NATS response shares this shape). */
export interface ProvisioningStatusPayload {
  organizationId: string;
  status: 'provisioning' | 'ready' | 'failed';
  namespace?: string;
  failureReason?: string;
  failureMessage?: string;
}
