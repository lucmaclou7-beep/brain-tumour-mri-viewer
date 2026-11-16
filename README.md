# Brain Tumour MRI Viewer

Educational MRI segmentation viewer by Luc MaClou, built with AI-assisted development. **Not clinically validated or for diagnosis.**

[Open the viewer](https://lucmaclou7-beep.github.io/brain-tumour-mri-viewer/) · [Final report](final-report.pdf)

## What is included

This repository distributes the static web viewer, final PDF report, and derived display assets for 51 held-out content-group representatives. It does not contain the complete training dataset, training code or model checkpoints. The viewer displays saved model predictions; it does not perform new inference.

Four MRI sequences, linked axial/coronal/sagittal views, reference and prediction overlays, 3D surfaces, and optional oedema boundary recovery.

## Evaluation

Duplicate audit: 484 case IDs, 114 near-duplicate pairs, 370 detected content groups. Splits were rebuilt by content group and models retrained before evaluation. Unique patient identities are not independently verified.

On 51 held-out content groups, mean oedema Dice improved from 0.6133 to 0.6289 and recall from 55.4% to 59.3%. Precision fell from 75.2% to 73.4%; mean false-positive oedema increased from 7.49 to 9.10 mL. Eight cases had worse Dice; twelve had over 2 mL of extra false positives. Recovery is off by default. This is internal, same-dataset evaluation, not external clinical validation.

The retained baseline is a small context neural network; 3D refers to the volumetric masks and viewer, not a 3D U-Net. See the report for methods and limitations.

## Run locally

Serve this folder with a static HTTP server, for example `python3 -m http.server 8000`, then open http://localhost:8000. No build step is required. Each case loads on demand (up to approximately 10 MB).

## Dataset attribution

Medical Segmentation Decathlon and contributors, Task01 BrainTumour. Source: https://registry.opendata.aws/msd/ . Derived display assets are shared under CC BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/ . Arrays are reoriented, intensities scaled for display, and annotations/predictions coloured. Dataset reference: Antonelli et al., Nature Communications 13, 4128 (2022), https://doi.org/10.1038/s41467-022-30695-9 .

The dataset licence applies to dataset-derived material; this repository does not grant a separate blanket open-source licence for all project code.
