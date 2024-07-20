# Home energy management and automation
This project is focused on home energy management and automation specifically designed for the Loxone Miniserver. It includes scripts that perform various tasks related to energy management. The scripts are written in C and are designed to be run on the Loxone Miniserver.

## EV Eco Power Calculation (ev-eco-power-calculation.c)
This script calculates the eco power for charging an electric vehicle (EV) based on solar power readings and user configurations. It decides the power to charge the car at, depending on the state of charge (SOC) of the battery and whether the car is already charging.

## PV Production Prediction (pv-production-prediction.c)
This script predicts photovoltaic (PV) production. It involves fetching weather data from MeteoBlue API to estimate future solar power production.

## Wattsonic Inverter State Manager (wattsonic-inverter-state-manager.c)
This script manages the state of an inverter based on various inputs such as current and predicted spot prices, SOC, and PV production predictions. It determines whether the inverter should be in economic mode, general mode, or UPS mode and sets limits on battery charge/discharge and grid injection power.
