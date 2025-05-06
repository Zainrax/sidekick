#!/bin/bash

# Check if the system is OSX
if [[ "$OSTYPE" == "darwin"* ]]; then
  echo "OSX detected. Please select your platform:"
  echo "1) Android"
  echo "2) iOS"
  read -p "Enter selection: " SELECTION
  case $SELECTION in
  1)
    PLATFORM='android'
    ;;
  2)
    PLATFORM='ios'
    ;;
  *)
    echo "Invalid selection!"
    exit 1
    ;;
  esac
else
  echo "Non-OSX system detected. Automatically selecting Android."
  PLATFORM='android'
fi

ionic cap run $PLATFORM -l --external --port=5173 --public-host="localhost"
