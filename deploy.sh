#!/bin/sh
# Build and deploy the current commit.
#
# Images are tagged with the commit they were built from, which is what makes
# it possible to tell what is running and to go back. The compose file falls
# back to `:latest` when TAG is not set, though — so a plain
# `docker compose up -d`, typed to restart something or to pick up an .env
# change, silently replaced production with whatever `latest` happened to be.
# It happened: the backend went back three weeks and every note save started
# failing. So every build moves `latest` onto what was just built, and the two
# can no longer disagree.
set -e
cd "$(dirname "$0")"

TAG=$(git rev-parse --short HEAD)
export TAG

if [ -n "$(git status --porcelain)" ]; then
    echo "! uncommitted changes — $TAG will not describe what you are deploying"
fi

echo "building $TAG"
# Everything, always. Building one service and then tagging all three as
# latest leaves the other two pointing at an image that does not exist —
# and the layer cache makes an unchanged service almost free anyway.
docker compose build

for service in backend frontend sync; do
    docker tag "knowledge-base-$service:$TAG" "knowledge-base-$service:latest"
done

echo "starting $TAG"
docker compose up -d

sleep 4
docker compose ps --format '{{.Service}}\t{{.Image}}\t{{.Status}}'
