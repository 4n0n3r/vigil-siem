//go:build windows

package agent

import (
	"context"
	"fmt"
	"os"
	"time"

	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/svc"
	"golang.org/x/sys/windows/svc/mgr"
)

const (
	serviceName        = "VIGILAgent"
	serviceDisplayName = "Vigil Security Agent"
	serviceDescription = "Vigil SIEM event collection agent"
)

// ----------------------------------------------------------------------------
// Service install / uninstall
// ----------------------------------------------------------------------------

// InstallService installs the current binary as a Windows Service.
func InstallService() error {
	exePath, err := os.Executable()
	if err != nil {
		return fmt.Errorf("could not determine executable path: %w", err)
	}

	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("could not connect to SCM: %w", err)
	}
	defer m.Disconnect()

	// Check if already installed.
	s, err := m.OpenService(serviceName)
	if err == nil {
		s.Close()
		return fmt.Errorf("service %q already exists — run 'vigil agent uninstall' first", serviceName)
	}

	s, err = m.CreateService(
		serviceName,
		exePath,
		mgr.Config{
			DisplayName: serviceDisplayName,
			StartType:   mgr.StartAutomatic,
			ServiceType: windows.SERVICE_WIN32_OWN_PROCESS,
			Description: serviceDescription,
		},
		"agent", "start",
	)
	if err != nil {
		return fmt.Errorf("could not create service: %w", err)
	}
	defer s.Close()

	return nil
}

// RestartService stops the Windows Service (if running) and starts it again.
func RestartService() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("could not connect to SCM: %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(serviceName)
	if err != nil {
		return fmt.Errorf("service %q not found — run 'vigil agent install' first: %w", serviceName, err)
	}
	defer s.Close()

	// Stop if running or starting.
	status, err := s.Query()
	if err != nil {
		return fmt.Errorf("could not query service status: %w", err)
	}
	if status.State == svc.Running || status.State == svc.StartPending {
		if _, err := s.Control(svc.Stop); err != nil {
			return fmt.Errorf("could not stop service: %w", err)
		}
		// Poll until stopped (timeout after 30s).
		deadline := time.Now().Add(30 * time.Second)
		for {
			status, err = s.Query()
			if err != nil {
				return fmt.Errorf("could not query service status while stopping: %w", err)
			}
			if status.State == svc.Stopped {
				break
			}
			if time.Now().After(deadline) {
				return fmt.Errorf("timed out waiting for service to stop")
			}
			time.Sleep(300 * time.Millisecond)
		}
	}

	if err := s.Start(); err != nil {
		return fmt.Errorf("could not start service: %w", err)
	}
	return nil
}

// UninstallService removes the Windows Service.
func UninstallService() error {
	m, err := mgr.Connect()
	if err != nil {
		return fmt.Errorf("could not connect to SCM: %w", err)
	}
	defer m.Disconnect()

	s, err := m.OpenService(serviceName)
	if err != nil {
		return fmt.Errorf("service %q not found: %w", serviceName, err)
	}
	defer s.Close()

	if err := s.Delete(); err != nil {
		return fmt.Errorf("could not delete service: %w", err)
	}
	return nil
}

// ----------------------------------------------------------------------------
// IsWindowsService detects whether the process was launched by the SCM.
// ----------------------------------------------------------------------------

// RunningAsService returns true when the process is running as a Windows Service.
func RunningAsService() bool {
	ok, err := svc.IsWindowsService()
	return err == nil && ok
}

// ----------------------------------------------------------------------------
// vigilService implements svc.Handler
// ----------------------------------------------------------------------------

// vigilService bridges the Windows Service control manager and the Agent.
type vigilService struct {
	agent *Agent
}

// Execute satisfies svc.Handler.
func (vs *vigilService) Execute(
	args []string,
	r <-chan svc.ChangeRequest,
	changes chan<- svc.Status,
) (bool, uint32) {
	const cmdsAccepted = svc.AcceptStop | svc.AcceptShutdown

	changes <- svc.Status{State: svc.StartPending}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	done := make(chan error, 1)
	go func() {
		done <- vs.agent.Run(ctx)
	}()

	changes <- svc.Status{State: svc.Running, Accepts: cmdsAccepted}

	for {
		select {
		case c := <-r:
			switch c.Cmd {
			case svc.Stop, svc.Shutdown:
				changes <- svc.Status{State: svc.StopPending}
				cancel()
				<-done
				changes <- svc.Status{State: svc.Stopped}
				return false, 0
			default:
				// Ignore all other control codes.
			}
		case <-done:
			changes <- svc.Status{State: svc.Stopped}
			return false, 0
		}
	}
}

// RunAsService starts the agent under Windows Service control.
func RunAsService(a *Agent) error {
	return svc.Run(serviceName, &vigilService{agent: a})
}
