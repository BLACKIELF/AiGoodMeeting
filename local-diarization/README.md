# 本地分人转写

独立运行时 1028v1（随应用 1028v3 发布）。Meetily v0.4.1 的独立 Python 运行时；当前默认采用 Sortformer v2.1 四人模型。普通话内容由本机 whisper.cpp large-v3-turbo 转写，无云端调用。

下文 `${SOURCE}`、`${RUNTIME}`、`${TASK_DATA}` 是各自源码、运行环境与模型/验收数据目录的占位符，请先替换为本机绝对路径。完整本机日志不上传仓库。

## 运行环境

- Python：`${RUNTIME}/diarization-venv/bin/python`，3.12.13。
- 模型：`${TASK_DATA}/模型/diarization/Sortformer-v2.1-4spk-fp32`，472,107,058 字节，最多四位匿名说话人。
- 转写模型：`${TASK_DATA}/模型/whisper/ggml-large-v3-turbo.bin`，复用已有文件。
- 复用 `/opt/homebrew/bin/whisper-cli` 1.9.5 与 `/opt/homebrew/bin/ffmpeg` 9.0.2。使用独立 Python 环境。
- MLX Audio 0.6.2 固定官方提交 `6ce7283be6f15f0cba37e839e73bfa4a08bbf040`；全部 38 个包固定在 `requirements.lock`。

```bash
"${RUNTIME}/diarization-venv/bin/python" \
  "${SOURCE}/local-diarization/transcribe.py" \
  --audio "/绝对路径/会议.wav" \
  --whisper-model "${TASK_DATA}/模型/whisper/ggml-large-v3-turbo.bin" \
  --diarization-model "${TASK_DATA}/模型/diarization/Sortformer-v2.1-4spk-fp32" \
  --whisper-cli /opt/homebrew/bin/whisper-cli \
  --ffmpeg /opt/homebrew/bin/ffmpeg \
  --language zh
```

`--language auto` 会让 Whisper 自动判断语言。所有输入路径必须是现有文件/目录的绝对路径。运行时强制 Hugging Face 离线模式；模型缺失会报错，不会自动下载。

## 接口

成功退出码 0，stdout 只输出一个 UTF-8 JSON；进度及诊断写 stderr。失败退出码 1，参数错误 2，SIGTERM 取消 143，SIGINT 取消 130；失败和取消不输出成功 JSON。

```json
{"schema_version":1,"model":"mlx-community/diar_streaming_sortformer_4spk-v2.1-fp32","segments":[{"start":1.2,"end":3.4,"speaker":"speaker_0","text":"示意接口格式"}],"speakers":["speaker_0"],"warnings":[]}
```

上面是接口示意。实际 ID 保持模型的 `speaker_0` 到 `speaker_3`，不识别人名；不确定片段为 `unknown`，用到的所有 ID 都声明在 `speakers`。时间单位为秒，按开始时间排序，结束严格晚于开始。无可用正文会报错。

Whisper 使用 `-ojf -ml 0` 保留原始词/token 时间。先逐词与分人概率对齐，再合并相邻同说话人词；不会按整句的主说话人硬贴标签。零时长词只可合入同一句内附近不超过 1.5 秒的实测短范围，并提示时间近似；异常词保留为 unknown。多人重叠、换人边界或证据不足均保留正文并提示复核。重叠双方的完整文字不能保证分别还原。

音频先转成 16 kHz 单声道临时 WAV。Sortformer 按 15.04 秒全局帧窗计算，保留 STFT 边缘及模型右侧上下文；分人概率保存在临时文件，以内存映射读取。Whisper 按两分钟正文窗、前后各两秒上下文处理。音频和概率不随总时长全部载入内存，最终转写正文仍随录音长度增长。取消只终止本次创建的子进程组，临时文件随后清理。

## 已执行检查

证据目录：`${TASK_DATA}/验收-分人-1028v1`。所有音频由已安装的 macOS `say` 声音合成，不含私人录音。

| 同一输入 | Sortformer 四人 | Nemotron 八人对照 |
|---|---|---|
| 双声音，32.75 秒，4 轮 | 通过，0/1/0/1；5.019 秒 | 通过；7.020 秒 |
| 三声音，50.17 秒，6 轮 | 通过，0/1/2/0/1/2；4.998 秒 | 失败，Tingting 与 Meijia 被合并；5.840 秒 |
| 双声音，131.00 秒，16 轮 | 全部编号保持一致；11.638 秒 | 通过；11.273 秒 |

判定要求每轮主说话人已知时长覆盖至少 50%，且不同声音映射不同 ID、同一声音后续 ID 一致。四人模型在双声音长样本的最低覆盖率 75.85%；最大 RSS 2,041,053,184 字节，由 macOS `/usr/bin/time -l` 记录，包含子进程。运行时间是这台 M4 Pro 的合成样本结果，不是自然会议准确率基准。

- 14 项确定性单测通过：一句内换人、80 ms 帧步长、重叠、时间缺失/倒退/零时长、不丢正文、概率异常失败、中文提示、SIGTERM 回收子进程及临时目录且保留无关进程。
- 有界 Sortformer 与官方文件模式在同一三声音样本上的 `628 × 4` 逐帧概率最大差及平均差均为 `0.0`。
- 断网限制运行、清理结果、完整命令输出及资源记录见证据目录与 `runtime-manifest-1028v1.json`。
- 失败的八人模型三声音样本和原始输出已保留；不用的八人权重与专用安装缓存按已确认配置清理。
- 未验证四人自然会议、远场噪声、长时间多人重叠或多小时准确率。相近声音可能被合并；四人是模型上限，不代表每次均能正确区分四人。

```bash
"${RUNTIME}/diarization-venv/bin/python" \
  -m unittest discover \
  -s "${SOURCE}/local-diarization/tests" \
  -p 'test_*.py' -v
```

`tests/make_fixture.py` 可重建样本；`tests/verify_fixture.py` 检查匿名分组；`tests/check_sortformer_parity.py` 比较官方概率。新增的 Eddy 样本仅作诊断素材，未用于替代失败三声音样本或验收结论。

## 来源与许可

- [MLX Audio 官方源码](https://github.com/Blaizzy/mlx-audio/tree/6ce7283be6f15f0cba37e839e73bfa4a08bbf040)：MIT，完整许可保存在模型目录的 `MLX-AUDIO-LICENSE`。
- [Sortformer MLX 模型](https://huggingface.co/mlx-community/diar_streaming_sortformer_4spk-v2.1-fp32/tree/8541fc3db304f350b544bbcab1cfae4f3eeb2356)：SHA-256 `dd18528b0e74a130501cde9beb655f9fc011e8718682728e2e88a981184cf282`。原始 [NVIDIA 模型](https://huggingface.co/nvidia/diar_streaming_sortformer_4spk-v2.1) 使用 [NVIDIA Open Model License](https://www.nvidia.com/en-us/agreements/enterprise-software/nvidia-open-model-license/)，模型目录保留卡片、来源记录与许可网页。
- [Nemotron 对照模型](https://huggingface.co/mlx-community/Nemotron-3-Diarization/tree/59ed2dbfc1346dcea9d423c71306a3a2499c568f) 使用 OpenMDW 1.1。来源、配置、哈希及许可已保存在证据目录的 `nemotron-model-notices/`；权重已清理，不再作为默认运行依赖。
