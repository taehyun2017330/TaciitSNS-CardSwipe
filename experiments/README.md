# Headless Steering Experiments

This runner tests whether swipe feedback can steer image generation toward a target without clicking through the browser UI.

It uses the same backend endpoints as the app:

1. `/api/swipe/synthesize-prompts`
2. `/api/swipe/generate-images`
3. `/api/swipe/analyze-images`

Then it asks an AI judge to compare each generated image to a target image or target brief, choose `like` or `dislike`, mark whether the image is a satisfactory endpoint, select rationale chips, optionally add a specific reason, and update preference memory for the next batch. The judge is prompted as a normal small-business owner, not a professional designer: it makes the action from a gut reaction first, explains the reason in plain language, picks only matching rationale chips, then scores endpoint closeness separately. It should like directionally useful images, reserve `satisfied=true` for endpoint-quality matches, and ignore rationale chips that do not fit the target context.

The preference updates are not reimplemented in Python. The runner starts a small Node steering bridge that imports the same TypeScript modules used by the interface:

- `frontend/src/preference/state.ts`
- `frontend/src/preference/feedback.ts`
- `frontend/src/preference/reasonExtraction.ts`
- `frontend/src/preference/semanticMemory.ts`
- `frontend/src/preference/strategyPolicy.ts`
- `frontend/src/preference/synthesis.ts`
- `frontend/src/components/swipe/generation.ts`
- `frontend/src/preference/constants.ts`

If those files change, the experiment uses the new logic automatically on the next run. The Python code only orchestrates the scalable experiment loop: API calls, image saving, AI judging, and report writing.

## Dry Run

```bash
python3 experiments/run_steering_experiment.py \
  --config experiments/example_steering_config.json \
  --dry-run
```

Dry run only checks that the runner can create the artifact folder. It does not call image generation, vision analysis, or the AI judge.

The first non-dry run also compiles a temporary steering bridge bundle in `experiments/.cache/`. That generated cache is ignored by git.

## Full Run

Start the backend first and make sure `backend/.env` has the keys used by the backend and judge.

```bash
python3 experiments/run_steering_experiment.py \
  --config experiments/example_steering_config.json
```

To compare against a concrete target image:

```bash
python3 experiments/run_steering_experiment.py \
  --config experiments/example_steering_config.json \
  --target-image /absolute/path/to/target.png
```

To run from a target image with no handwritten onboarding, let the script inspect the image and create normal-user onboarding text first:

```bash
python3 experiments/run_steering_experiment.py \
  --target-image "/Users/taehyun/Downloads/demo/experiments/input images/image 1.png" \
  --auto-onboarding-from-target \
  --initial-batch-size 8 \
  --batches 10 \
  --batch-size 8
```

This command streams progress to the terminal and writes the same messages to `run.log`, so the next run is just a script invocation plus watching the log.

For a long convergence run, keep the first 8 images broad and let the experiment continue until the judge marks a candidate as satisfactory or the max batch cap is reached:

```bash
python3 experiments/run_steering_experiment.py \
  --target-image "/Users/taehyun/Downloads/demo/experiments/input images/image 1.png" \
  --auto-onboarding-from-target \
  --initial-batch-size 8 \
  --batch-size 8 \
  --batches 12 \
  --target-score 0.9 \
  --min-batches 2 \
  --analysis-batch-size 2
```

`--batches` is a maximum cap, not the intended stopping point. The normal stop condition is `satisfied=true` from the AI judge plus a score at or above `--target-score`. Use `--no-stop-at-target` only when you want all requested batches to run no matter how high the score gets.

The first batch uses a wide diversity slate: eight different visual lanes with different camera distance, palette, setting, typography, lighting, texture, and product staging. Later batches use the same preference memory but move toward convergence.

The current app onboarding only contains brand/project, category, post goal, and audience. The runner keeps legacy `tone` and `avoid` fields empty internally only because the shared frontend/backend request types still include them.

## Target Suite

Run the same experiment settings across every image in `experiments/input images/`:

```bash
python3 experiments/run_target_suite.py \
  --batches 12 \
  --initial-batch-size 8 \
  --batch-size 8 \
  --target-score 0.9 \
  --min-batches 2 \
  --analysis-batch-size 2
```

The suite writes `experiments/suites/<timestamp>-target-suite/suite-summary.md` with one row per target and links to each target's best generated image.

## Outputs

Each run creates `experiments/runs/<timestamp>-<run-name>/` with:

- `config.json`: exact inputs used for the run
- `target-understanding.json`: AI-generated target description and onboarding text, when `--auto-onboarding-from-target` is used
- `run.log`: human-readable live log for following the experiment while it runs
- `images/`: every generated image, saved as files
- `api/`: redacted backend responses for prompt synthesis, generation, and analysis
- `events.jsonl`: chronological log of health checks, batches, generated images, actions, selected reasons, scores, and problems
- `preference-state.json`: final preference state produced by the frontend steering logic
- `feedback-events.json`: feedback events in the same shape used by the interface
- `records.json`: one structured record per reviewed image
- `summary.md`: readable experiment report with best candidate, timeline, final memory, and possible problems

## Notes

The full run sends generated images, and the optional target image, to the AI judge model configured by `judgeModel`. The default judge and target-onboarding reader are `gpt-4o` because they are evaluating image similarity, layout, text treatment, and visual details. Use `--judge-model` or `--target-onboarding-model` to override them, and use `--target-brief` only if you want a text-only target.
