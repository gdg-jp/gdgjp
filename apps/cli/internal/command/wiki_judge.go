package command

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/gdg-jp/gdgjp/cli/internal/wiki/judge"
	"github.com/gdg-jp/gdgjp/cli/internal/wiki/runner"
	"github.com/spf13/cobra"
)

// newWikiJudgeCommand is `gdg wiki judge`: score eval answers for faithfulness with the
// local Codex (read-only sandbox), writing verdicts back into the results file.
func newWikiJudgeCommand() *cobra.Command {
	var input, backendName, model string
	command := &cobra.Command{
		Use:   "judge",
		Short: "Judge eval answers for faithfulness with a local coding agent",
		Args:  cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			backend, err := runner.NewBackend(backendName, model)
			if err != nil {
				return err
			}
			answerer, ok := backend.(judge.Backend)
			if !ok {
				return fmt.Errorf("backend %s cannot run schema-checked sessions", backendName)
			}
			results, err := judge.ReadResults(input)
			if err != nil {
				return err
			}
			workdir, err := os.MkdirTemp("", "gdg-judge-")
			if err != nil {
				return err
			}
			defer os.RemoveAll(workdir)
			faithful, judged := 0, 0
			for _, result := range results.Results {
				var id, question string
				_ = json.Unmarshal(result["id"], &id)
				_ = json.Unmarshal(result["question"], &question)
				answer := result["answer"]
				if len(answer) == 0 || string(answer) == "null" {
					continue
				}
				var evidence map[string]string
				_ = json.Unmarshal(result["evidence"], &evidence)
				verdict, judgeErr := judge.Judge(cmd.Context(), answerer, workdir, question, answer, evidence)
				if judgeErr != nil {
					fmt.Fprintf(cmd.ErrOrStderr(), "%s: judge failed: %v\n", id, judgeErr)
					continue
				}
				encoded, _ := json.Marshal(verdict)
				result["judge"] = encoded
				judged++
				if verdict.Verdict == "faithful" {
					faithful++
				}
				fmt.Fprintf(cmd.OutOrStdout(), "%s: %s\n", id, verdict.Verdict)
			}
			rate := 0.0
			if judged > 0 {
				rate = float64(faithful) / float64(judged)
			}
			if err = results.Write(input, rate, judged); err != nil {
				return err
			}
			_, err = fmt.Fprintf(cmd.OutOrStdout(), "faithfulness %.3f (%d/%d)\n", rate, faithful, judged)
			return err
		},
	}
	command.Flags().StringVar(&input, "input", "", "Eval results JSON (apps/agent/eval/results/*.json)")
	command.Flags().StringVar(&backendName, "backend", "codex", "Judge backend (codex)")
	command.Flags().StringVar(&model, "model", "", "Model override")
	_ = command.MarkFlagRequired("input")
	return command
}
