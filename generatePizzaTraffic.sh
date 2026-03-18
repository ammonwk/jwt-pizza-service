#!/bin/bash

if [ -z "$1" ]; then
  echo "Usage: $0 <host>"
  echo "  e.g. $0 https://pizza-service.ammonkunzler.com"
  exit 1
fi

host=$1

# Kill all background processes on exit
trap 'kill $(jobs -p) 2>/dev/null; exit' SIGINT SIGTERM EXIT

echo "Starting traffic simulation against $host"

# Menu polling every 3 seconds
while true; do
  status=$(curl -s -o /dev/null -w "%{http_code}" "$host/api/order/menu")
  echo "Requesting menu... $status"
  sleep 3
done &

# Failed login attempt every 25 seconds
while true; do
  status=$(curl -s -o /dev/null -w "%{http_code}" -X PUT "$host/api/auth" \
    -d '{"email":"unknown@jwt.com", "password":"bad"}' \
    -H 'Content-Type: application/json')
  echo "Failed login attempt... $status"
  sleep 25
done &

# Login -> wait 2 min -> logout
while true; do
  response=$(curl -s -X PUT "$host/api/auth" \
    -d '{"email":"f@jwt.com", "password":"franchisee"}' \
    -H 'Content-Type: application/json')
  token=$(echo "$response" | jq -r '.token')
  echo "Logged in franchisee..."
  sleep 110
  curl -s -X DELETE "$host/api/auth" -H "Authorization: Bearer $token" > /dev/null
  echo "Logged out franchisee..."
  sleep 10
done &

# Login -> buy pizza -> logout
while true; do
  response=$(curl -s -X PUT "$host/api/auth" \
    -d '{"email":"d@jwt.com", "password":"diner"}' \
    -H 'Content-Type: application/json')
  token=$(echo "$response" | jq -r '.token')
  echo "Logged in diner..."
  curl -s -X POST "$host/api/order" \
    -H 'Content-Type: application/json' \
    -d '{"franchiseId": 1, "storeId":1, "items":[{ "menuId": 1, "description": "Veggie", "price": 0.05 }]}' \
    -H "Authorization: Bearer $token" > /dev/null
  echo "Bought a pizza..."
  sleep 20
  curl -s -X DELETE "$host/api/auth" -H "Authorization: Bearer $token" > /dev/null
  echo "Logged out diner..."
  sleep 30
done &

# Force order failure (too many pizzas) every 5 minutes
while true; do
  response=$(curl -s -X PUT "$host/api/auth" \
    -d '{"email":"d@jwt.com", "password":"diner"}' \
    -H 'Content-Type: application/json')
  token=$(echo "$response" | jq -r '.token')
  echo "Login hungry diner..."
  items='{ "menuId": 1, "description": "Veggie", "price": 0.05 }'
  for (( i=0; i < 21; i++ ))
  do items+=', { "menuId": 1, "description": "Veggie", "price": 0.05 }'
  done
  curl -s -X POST "$host/api/order" \
    -H 'Content-Type: application/json' \
    -d "{\"franchiseId\": 1, \"storeId\":1, \"items\":[$items]}" \
    -H "Authorization: Bearer $token" > /dev/null
  echo "Bought too many pizzas..."
  sleep 5
  curl -s -X DELETE "$host/api/auth" -H "Authorization: Bearer $token" > /dev/null
  sleep 295
done &

echo "Traffic simulation running. Press Ctrl+C to stop."
wait
