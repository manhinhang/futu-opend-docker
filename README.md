# Futu OpenD Docker

[![Docker Pulls](https://img.shields.io/github/package-json/v/manhinhang/futu-opend-docker)](https://github.com/manhinhang/futu-opend-docker/packages)
[![GitHub](https://img.shields.io/github/license/manhinhang/futu-opend-docker)](https://github.com/manhinhang/futu-opend-docker/blob/main/LICENSE)

lightweight futu opend docker

## Pull the docker image from GitHub Container Registry

```bash
# default base image is ubuntu
docker pull ghcr.io/manhinhang/futu-opend-docker:ubuntu-stable
```

## container tags pattern

| Base Image | Tags                   |
| ---------- | ---------------------- |
| ubuntu     | ubuntu-stable          |
| ubuntu     | ubuntu-beta            |
| ubuntu     | ubuntu-{opend_version} |
| centos     | centos-stable          |
| centos     | centos-beta            |
| centos     | centos-{opend_version} |

## Create a container from the image and run it

> You need to create [FutuOpenD.xml](https://openapi.futunn.com/futu-api-doc/opend/opend-cmd.html) file
> generate your own RSA key
>
> ```bash
> openssl genrsa -out futu.pem 1024
> ```

PEM file should config in XML

```xml
...
<rsa_private_key>/bin/futu.pem</rsa_private_key>
...
```

```bash
docker run -it --name futu-opend-docker \
-v $(pwd)/FutuOpenD.xml:/bin/FutuOpenD.xml \
-v $(pwd)/futu.pem:/bin/futu.pem \
-p 11111:11111 \
-p 22222:22222 \
ghcr.io/manhinhang/futu-opend-docker
```

> **Port mappings**:
> - `11111`: API port for FutuOpenD protocol
> - `22222`: Telnet port for 2FA input (optional, but recommended for automation)

### Input verification codes

FutuOpenD may require two types of verification:

1. **SMS verification code** - sent to your phone
2. **Picture CAPTCHA** - downloaded to container

You can input verification codes using either `docker attach` or telnet:

#### Method 1: Using docker attach

1. Attach to futu opend container

```bash
docker attach futu-opend
```

2. Input verification code based on the type:

**For SMS verification code:**
```bash
input_phone_verify_code -code=<SMS_CODE>
```

**For picture CAPTCHA:**

First, copy the CAPTCHA image from container:
```bash
docker cp futu-opend:/home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png ./PicVerifyCode.png
```

Then view the image and input the code:
```bash
input_pic_verify_code -code=<CAPTCHA_CODE>
```

#### Method 2: Using telnet (recommended for automation)

Connect to the FutuOpenD telnet port (22222) and send the command:

**For SMS verification code:**

```bash
# Interactive
telnet localhost 22222
input_phone_verify_code -code=<SMS_CODE>

# One-liner
echo "input_phone_verify_code -code=<SMS_CODE>" | telnet localhost 22222
```

**For picture CAPTCHA:**

First, extract the CAPTCHA image:
```bash
docker cp futu-opend:/home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png ./PicVerifyCode.png
```

Then input the code via telnet:
```bash
echo "input_pic_verify_code -code=<CAPTCHA_CODE>" | telnet localhost 22222
```

**Automation script example:**

```bash
#!/bin/bash
# Auto-input SMS verification code
{
  sleep 2
  echo "input_phone_verify_code -code=$1"
  sleep 1
} | telnet localhost 22222
```

```bash
#!/bin/bash
# Auto-input picture CAPTCHA
# First extract and display the image, then input the code
docker cp futu-opend:/home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png /tmp/PicVerifyCode.png
# Display image (choose your preferred viewer)
open /tmp/PicVerifyCode.png  # macOS
# xdg-open /tmp/PicVerifyCode.png  # Linux
# start /tmp/PicVerifyCode.png  # Windows

read -p "Enter CAPTCHA code: " captcha_code
{
  sleep 2
  echo "input_pic_verify_code -code=$captcha_code"
  sleep 1
} | telnet localhost 22222
```

## Run in docker compose

Edit `.env`

| Enviroment Variable     | Description                        |
| ---------------------- | ---------------------------------- |
| FUTU_ACCOUNT_ID        | Futu account ID                    |
| FUTU_ACCOUNT_PWD       | Futu account password              |
| FUTU_RSA_FILE_PATH     | Futu RSA file path in container    |
| FUTU_OPEND_IP          | Futu OpenD IP in container         |
| FUTU_OPEND_PORT        | Futu OpenD API Port in container   |
| FUTU_OPEND_TELNET_PORT | Futu OpenD Telnet Port (default: 22222) |

```bash
docker compose up -d
```

Then enter verification codes when prompted:

**Using docker attach:**

```bash
docker attach futu-opend

# For SMS verification
input_phone_verify_code -code=<SMS_CODE>

# For picture CAPTCHA (extract image first)
docker cp futu-opend:/home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png ./PicVerifyCode.png
input_pic_verify_code -code=<CAPTCHA_CODE>
```

**Using telnet** (see [Input verification codes](#input-verification-codes) section for full details):

```bash
# For SMS verification
echo "input_phone_verify_code -code=<SMS_CODE>" | telnet localhost 22222

# For picture CAPTCHA
docker cp futu-opend:/home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png ./PicVerifyCode.png
echo "input_pic_verify_code -code=<CAPTCHA_CODE>" | telnet localhost 22222
```

## Build locally

> **Note**: Ubuntu builds require version 9.4.x or later with Ubuntu 18.04 base image. Ubuntu 16.04 builds are no longer provided by Futu.

- Use ubuntu as base image

```bash
docker build -t futu-opend-docker --build-arg FUTU_OPEND_VER=10.0.6008 --build-arg BASE_IMG=ubuntu .
```

- Use centos as base image

```bash
docker build -t futu-opend-docker --build-arg FUTU_OPEND_VER=10.0.6008 --build-arg BASE_IMG=centos .
```

## Troubleshooting

### Download failures

If you encounter download failures during build:

1. **Network issues**: The download script includes automatic retry logic (3 attempts)
2. **Version compatibility**: Ensure you're using a version that has Ubuntu 18.04 builds (9.4.x or later)
3. **Check available versions**: Visit [Futu OpenD download page](https://www.futunn.com/en/download/OpenAPI)

### Container startup issues

If the container fails to start:

1. **RSA key**: Ensure `futu.pem` exists and is properly mounted
2. **Config file**: Verify `FutuOpenD.xml` is valid XML
3. **Verification required**: First run may require verification codes

### Verification codes

FutuOpenD may prompt for two types of verification:

1. **SMS verification code** (`input_phone_verify_code`)
   - Sent to your registered phone number
   - Input via docker attach or telnet

2. **Picture CAPTCHA** (`input_pic_verify_code`)
   - Downloaded to `/home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png` inside container
   - Extract with: `docker cp futu-opend:/home/futu/.com.futunn.FutuOpenD/F3CNN/PicVerifyCode.png ./PicVerifyCode.png`
   - View the image and input the code

**Tip**: Use telnet method for automation - see [Input verification codes](#input-verification-codes) section for details.

## Disclaimer

This project is not affiliated with [Futu Securities International (Hong Kong) Limited](https://www.futuhk.com/).

Good luck and enjoy.
