# Energy Management for Loxone and Wattsonic G3 Inverter

## Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Hardware Requirements](#hardware-requirements)
- [Software Requirements](#software-requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Usage](#usage)
- [Contributing](#contributing)
- [License](#license)
- [Contact](#contact)

## Overview

The energy management system key components includes, Loxone charging station, photovoltaic (PV) production, fluctuating spot prices connector, PV production prediction, and a Wattsonic G3 inverter. This setup features scripts tailored to optimize both energy consumption and production, taking into account the current state of the system and the user's preferences.

## Features

### EV Eco Power Calculation
This script calculates the eco power for charging an electric vehicle (EV) based on solar power readings and user configurations. It decides the power to charge the car at, depending on the state of charge (SOC) of the battery and whether the car is already charging. Script [location](/loxone/scripts/ev-eco-power-calculation.c).

### PV Production Prediction
This script predicts photovoltaic (PV) production. It involves fetching weather data from MeteoBlue API to estimate future solar power production. Script [location](/loxone/scripts/pv-production-prediction.c).

### Wattsonic Inverter State Manager
This script manages the state of an inverter based on various inputs such as current and predicted spot prices, SOC, and PV production predictions. It determines whether the inverter should be in economic mode, general mode, or UPS mode and sets limits on battery charge/discharge and grid injection power. Script [location](/loxone/scripts/wattsonic-inverter-state-manager.c).

## Hardware Requirements

- Loxone Miniserver
- Loxone Wallbox for EV charging
- Loxone Modbus Extension for Wattsonice inverter communication
- Wattsonic G3 inverter

## Software Requirements

- Loxone Config software
- MeteoBlue account (free tier is sufficient) and API key for weather data retrieval

## Installation

1. **Clone the repository:**
    ```bash
    git clone https://github.com/janhalama/home-automation.git
    cd home-automation
    ```

2. **Upload Scripts to Loxone Config:**
    - Open Loxone Config software.
    - Import the necessary scripts from the repository into your Loxone project program blocks.

## Configuration

1. **Configure script constants:**
    - Edit the script constants to match your setup and needs.

2. **Configure Loxone block inputs:**
    - Connect user inputs and Wattsonic inverter registers.

## Usage

1. **Start the System:**
    - Deploy the configuration to the Loxone Miniserver and enjoy.

## Contributing

Contributions to enhance the functionality of these scripts are welcome. Follow these steps to contribute:

1. Fork the repository.
2. Create a new branch (`git checkout -b feature/xyz`).
3. Commit your changes (`git commit -am 'feat: Add feature xyz'`).
4. Push to the branch (`git push origin feature-xyz`).
5. Create a new Pull Request.

Please ensure your contributions adhere to the following guidelines:
- Proper documentation of the added features.
- Compatibility with the Loxone system.

## License

This project is licensed under a proprietary license. See the [LICENSE](LICENSE) file for more details.

## Contact

For questions or support, please contact Jan Halama via [GitHub](https://github.com/janhalama).