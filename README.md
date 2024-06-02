# Datacurve Take Home Assessment

Author: Alex Li

Website with a code execution environment (write Python 3 code in an editor and execute remotely)

![Executing code in a secure environment](image.png)
(Figure 1: Executing code in a secure environment -> does not allow modification of filesystem)

Program will execute remote Python3 code sent by the user in a trusted container environment created in Docker.

The container will already have the prerequisite Python packages like `pandas` and `scipy` installed.

## How to run

> Created purely as a dev env, app will be served on localhost

server + db: `cd server && docker compose up` \
client: `cd frontend && npm run dev`

server: `port 8000` \
postgres db: `port 5432` \
client: `port 5173`

## Challenges encountered and my solution to the problem

Originally I wanted to have an asynchronous task queue (e.g with RabbitMQ) that would keep track of the user's submissions and a pool of worker containers that can execute code in a trusted and completely isolated environment for maximum security.

Ideally, this would have been a better solution because I can decouple the code execution processes from the web server functions and it is much more scalable to the workload presented (i.e when the workers are taking some time to execute code, the server can be off to process new requests). I can also limit the number of vCPUs and memory allocated to each worker. However, I found this solution challenging to implement in practice and test sufficiently within the alloted time.

The solution I came up with will still ensure security by placing the server within a trusted container with non-root user permissions and spawn child processes within this trusted container. In theory, each child process should inherit the same non-root access rights as the parent process, so all code should be executed safely.

The limitations of my approach are that the child processes must share the same environment as the server (i.e same python version of 3.11) and the child process may only have access to packages available on the server.
