/**
 * Service Deployment Pipeline
 * Manage service deployment and versioning
 */

export class DeploymentPipeline {
  constructor() {
    this.deployments = [];
    this.stages = ['build', 'test', 'staging', 'production'];
    this.rollbacks = [];
  }

  createDeployment(serviceName, version, config = {}) {
    const deployment = {
      id: `${serviceName}-${version}-${Date.now()}`,
      serviceName,
      version,
      status: 'pending',
      stages: this.stages.map((stage) => ({
        name: stage,
        status: 'pending',
        startTime: null,
        endTime: null,
      })),
      config,
      createdAt: Date.now(),
    };

    this.deployments.push(deployment);
    return deployment;
  }

  updateStageStatus(deploymentId, stageName, status) {
    const deployment = this.deployments.find((d) => d.id === deploymentId);
    if (!deployment) return null;

    const stage = deployment.stages.find((s) => s.name === stageName);
    if (stage) {
      stage.status = status;
      stage.startTime = Date.now();
      if (status === 'completed' || status === 'failed') {
        stage.endTime = Date.now();
      }
    }

    // Update deployment status
    const allCompleted = deployment.stages.every((s) => s.status !== 'pending');
    const anyFailed = deployment.stages.some((s) => s.status === 'failed');
    deployment.status = anyFailed ? 'failed' : allCompleted ? 'completed' : 'in_progress';

    return deployment;
  }

  rollback(serviceName, fromVersion, toVersion) {
    const rollback = {
      id: `rollback-${serviceName}-${Date.now()}`,
      serviceName,
      fromVersion,
      toVersion,
      status: 'in_progress',
      createdAt: Date.now(),
    };

    this.rollbacks.push(rollback);
    return rollback;
  }

  completeRollback(rollbackId) {
    const rollback = this.rollbacks.find((r) => r.id === rollbackId);
    if (rollback) {
      rollback.status = 'completed';
      rollback.completedAt = Date.now();
    }
    return rollback;
  }

  getDeployments(serviceName = null) {
    if (serviceName) {
      return this.deployments.filter((d) => d.serviceName === serviceName);
    }
    return this.deployments;
  }

  getRollbacks() {
    return this.rollbacks;
  }
}

export const createDeploymentPipeline = () => new DeploymentPipeline();
