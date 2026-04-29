import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DeploymentDetailActions } from './DeploymentDetailActions';

describe('DeploymentDetailActions', () => {
  it('calls onRedeploy when redeploy action is triggered', async () => {
    const onRedeploy = vi.fn().mockResolvedValue(undefined);

    render(
      <DeploymentDetailActions
        deploymentId="dep-1"
        deploymentName="stellar-app"
        deploymentUrl={null}
        repositoryUrl={null}
        onRedeploy={onRedeploy}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('deployment-redeploy-btn'));

    await waitFor(() => {
      expect(onRedeploy).toHaveBeenCalledWith('dep-1');
    });
  });

  it('requires exact deployment name before delete confirmation can be submitted', () => {
    render(
      <DeploymentDetailActions
        deploymentId="dep-1"
        deploymentName="stellar-app"
        deploymentUrl={null}
        repositoryUrl={null}
        onRedeploy={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByTestId('deployment-delete-btn'));

    const confirmButton = screen.getByTestId('deployment-confirm-delete-btn') as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Confirm deployment name'), {
      target: { value: 'stellar-app' },
    });

    expect(confirmButton.disabled).toBe(false);
  });

  it('calls onDelete only after confirmation text is valid', async () => {
    const onDelete = vi.fn().mockResolvedValue(undefined);

    render(
      <DeploymentDetailActions
        deploymentId="dep-1"
        deploymentName="stellar-app"
        deploymentUrl={null}
        repositoryUrl={null}
        onRedeploy={vi.fn()}
        onDelete={onDelete}
      />,
    );

    fireEvent.click(screen.getByTestId('deployment-delete-btn'));
    fireEvent.change(screen.getByLabelText('Confirm deployment name'), {
      target: { value: 'stellar-app' },
    });
    fireEvent.click(screen.getByTestId('deployment-confirm-delete-btn'));

    await waitFor(() => {
      expect(onDelete).toHaveBeenCalledWith('dep-1');
    });
  });
});
