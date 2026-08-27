# Image vs container

**Position:** Source → Image → Container process

Image là artifact bất biến theo layer; container là instance runtime có process/filesystem/network context riêng.

Experiment: build image, run nhiều containers, thay file trong container, xoá/recreate để thấy dữ liệu ephemeral.
