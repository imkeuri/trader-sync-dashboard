import trades from './assets/trades.csv';

import React, { useState, useEffect } from 'react';
import { 
  LineChart, Line, BarChart, Bar, PieChart, Pie, 
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, 
  ResponsiveContainer, Cell
} from 'recharts';
import Papa from 'papaparse';
import _ from 'lodash';

const App = () => {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState({
    totalPL: 0,
    winRate: 0,
    tradeCount: 0,
    avgTrade: 0,
    dateRange: { start: '', end: '' },
    topSymbols: [],
    plByType: []
  });
  const [activeTab, setActiveTab] = useState('overview');
  const [filterSymbol, setFilterSymbol] = useState('');
  const [timeframe, setTimeframe] = useState('all');
  const [error, setError] = useState('');

  // Custom color palette
  const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d'];
  
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    setLoading(true);
    setError('');
    
    const reader = new FileReader();
    reader.onload = (e) => {
      const csvText = e.target.result;
      
      Papa.parse(csvText, {
        header: true,
        dynamicTyping: true,
        skipEmptyLines: true,
        complete: (results) => {
          try {
            if (results.errors.length > 0) {
              setError(`CSV parsing error: ${results.errors[0].message}`);
              setLoading(false);
              return;
            }
            
            if (results.data.length === 0) {
              setError('No data found in the uploaded file');
              setLoading(false);
              return;
            }
            
            // Clean and process the data
            const cleanedData = results.data.map(trade => ({
              ...trade,
              Amount: parseFloat(trade.Amount) || 0,
              Price: parseFloat(trade.Price) || 0,
              Commission: parseFloat(trade.Commission) || 0,
              ActivityDate: new Date(trade['Activity Date'] || ''),
              Symbol: trade.Symbol?.trim() || 'Unknown',
              Transaction: trade.Transaction || 'Unknown',
              Type: trade.Type || 'Unknown'
            }));
            
            setTrades(cleanedData);
            calculateSummary(cleanedData);
            setLoading(false);
          } catch (err) {
            setError(`Error processing data: ${err.message}`);
            setLoading(false);
          }
        },
        error: (error) => {
          setError(`Error parsing CSV: ${error.message}`);
          setLoading(false);
        }
      });
    };
    
    reader.onerror = () => {
      setError('Error reading file');
      setLoading(false);
    };
    
    reader.readAsText(file);
  };

  useEffect(() => {
    if (trades.length > 0) {
      let filteredTrades = [...trades];
      
      // Apply symbol filter if one is set
      if (filterSymbol) {
        filteredTrades = filteredTrades.filter(trade => 
          trade.Symbol?.toLowerCase().includes(filterSymbol.toLowerCase())
        );
      }
      
      // Apply timeframe filter
      if (timeframe !== 'all') {
        const now = new Date();
        const cutoffDate = new Date();
        
        switch(timeframe) {
          case 'week':
            cutoffDate.setDate(now.getDate() - 7);
            break;
          case 'month':
            cutoffDate.setMonth(now.getMonth() - 1);
            break;
          case 'quarter':
            cutoffDate.setMonth(now.getMonth() - 3);
            break;
          default:
            break;
        }
        
        filteredTrades = filteredTrades.filter(trade => 
          trade.ActivityDate >= cutoffDate
        );
      }
      
      calculateSummary(filteredTrades);
    }
  }, [trades, filterSymbol, timeframe]);

  const calculateSummary = (tradeData) => {
    if (!tradeData.length) return;
    
    // Sort by date for calculations
    const sortedTrades = _.sortBy(tradeData, 'ActivityDate');
    
    // Calculate P/L by matching opening and closing positions
    const positions = {};
    const closedTrades = [];
    
    // Group trades by symbol and match opening/closing positions
    sortedTrades.forEach(trade => {
      const key = `${trade.Symbol}-${trade.CallPut || 'stock'}`;
      
      if (!positions[key]) {
        positions[key] = [];
      }
      
      // For simplicity, treat Buy as opening and Sell as closing
      // In a real system, you'd need to track position direction more carefully
      if (trade.Transaction === 'Buy') {
        positions[key].push({
          ...trade,
          remainingQuantity: trade.Quantity
        });
      } else if (trade.Transaction === 'Sell') {
        let remainingQty = trade.Quantity;
        let costBasis = 0;
        let closingAmount = trade.Amount;
        
        // Match this sell against available buy positions using FIFO
        while (remainingQty > 0 && positions[key].length > 0) {
          const openPosition = positions[key][0];
          
          if (openPosition.remainingQuantity <= remainingQty) {
            // Close entire open position
            const qtyToClose = openPosition.remainingQuantity;
            const openAmount = (openPosition.Price * qtyToClose) + 
                              (openPosition.Commission || 0);
            const closeAmount = (trade.Price * qtyToClose) - 
                               ((trade.Commission || 0) * (qtyToClose / trade.Quantity));
            
            closedTrades.push({
              symbol: trade.Symbol,
              openDate: openPosition.ActivityDate,
              closeDate: trade.ActivityDate, 
              quantity: qtyToClose,
              openPrice: openPosition.Price,
              closePrice: trade.Price,
              pl: closeAmount - openAmount,
              type: trade.Type,
              callPut: trade.CallPut
            });
            
            remainingQty -= qtyToClose;
            positions[key].shift(); // Remove fully closed position
          } else {
            // Partially close position
            const qtyToClose = remainingQty;
            const openAmount = (openPosition.Price * qtyToClose) + 
                             ((openPosition.Commission || 0) * (qtyToClose / openPosition.Quantity));
            const closeAmount = (trade.Price * qtyToClose) - 
                              ((trade.Commission || 0) * (qtyToClose / trade.Quantity));
            
            closedTrades.push({
              symbol: trade.Symbol,
              openDate: openPosition.ActivityDate,
              closeDate: trade.ActivityDate,
              quantity: qtyToClose, 
              openPrice: openPosition.Price,
              closePrice: trade.Price,
              pl: closeAmount - openAmount,
              type: trade.Type,
              callPut: trade.CallPut
            });
            
            openPosition.remainingQuantity -= qtyToClose;
            remainingQty = 0;
          }
        }
        
        // If there are still remaining quantities to sell but no matching buys,
        // this could be a short position or data error - handle accordingly
        if (remainingQty > 0) {
          console.warn(`Unmatched sell for ${key}, qty: ${remainingQty}`);
        }
      }
    });
    
    // Calculate total P/L from matched trades
    const totalPL = _.sumBy(closedTrades, 'pl');
    
    // Calculate win rate 
    const winningTrades = closedTrades.filter(trade => trade.pl > 0);
    const winRate = closedTrades.length > 0 
      ? (winningTrades.length / closedTrades.length) * 100
      : 0;
    
    // Get date range
    const dateRange = {
      start: sortedTrades[0].ActivityDate,
      end: sortedTrades[sortedTrades.length - 1].ActivityDate
    };
    
    // Calculate average trade P/L
    const avgTrade = totalPL / tradeData.length;
    
    // Get top traded symbols using matched trade data
    const symbolCounts = _.countBy(closedTrades, 'symbol');
    const plBySymbol = _.chain(closedTrades)
      .groupBy('symbol')
      .map((trades, symbol) => ({
        symbol,
        pl: _.sumBy(trades, 'pl')
      }))
      .value();
      
    const topSymbols = Object.entries(symbolCounts)
      .map(([symbol, count]) => {
        const matchingSymbol = plBySymbol.find(s => s.symbol === symbol);
        return {
          symbol,
          count,
          pl: matchingSymbol ? matchingSymbol.pl : 0
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
      
    // Calculate P/L by security type
    const plByType = _.chain(closedTrades)
      .groupBy('type')
      .map((trades, type) => ({
        type,
        pl: _.sumBy(trades, 'pl')
      }))
      .value();
      
    // P/L by month (using closing date)
    const plByMonth = _.chain(closedTrades)
      .groupBy(trade => {
        const date = new Date(trade.closeDate);
        return `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
      })
      .map((trades, month) => ({
        month,
        pl: _.sumBy(trades, 'pl'),
        tradeCount: trades.length
      }))
      .sortBy('month')
      .value();
      
    // Add closed trades to summary
    setSummary({
      totalPL,
      winRate,
      tradeCount: closedTrades.length,
      avgTrade: closedTrades.length > 0 ? totalPL / closedTrades.length : 0,
      dateRange,
      topSymbols,
      plByType: plByType.length ? plByType : fallbackPlByType,
      plByMonth,
      closedTrades // Store the matched trades for detailed reporting
    });
  };

  const renderDateRange = () => {
    if (!summary.dateRange.start || !summary.dateRange.end) return 'N/A';
    
    const formatDate = (date) => {
      return date instanceof Date 
        ? date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
        : 'Invalid Date';
    };
    
    return `${formatDate(summary.dateRange.start)} - ${formatDate(summary.dateRange.end)}`;
  };

  const renderOverviewTab = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium mb-4">Performance Summary</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-gray-50 p-4 rounded">
            <p className="text-sm text-gray-500">Total P/L</p>
            <p className={`text-2xl font-bold ${summary.totalPL >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              ${summary.totalPL?.toFixed(2) || '0.00'}
            </p>
          </div>
          <div className="bg-gray-50 p-4 rounded">
            <p className="text-sm text-gray-500">Win Rate</p>
            <p className="text-2xl font-bold text-blue-600">{summary.winRate?.toFixed(1) || '0.0'}%</p>
          </div>
          <div className="bg-gray-50 p-4 rounded">
            <p className="text-sm text-gray-500">Total Trades</p>
            <p className="text-2xl font-bold">{summary.tradeCount || 0}</p>
          </div>
          <div className="bg-gray-50 p-4 rounded">
            <p className="text-sm text-gray-500">Avg. Trade P/L</p>
            <p className={`text-2xl font-bold ${(summary.avgTrade || 0) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              ${summary.avgTrade?.toFixed(2) || '0.00'}
            </p>
          </div>
        </div>
        <div className="mt-4">
          <p className="text-sm text-gray-500">Trading Period</p>
          <p className="text-md">{renderDateRange()}</p>
        </div>
      </div>
      
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium mb-4">Top Traded Symbols</h3>
        {summary.topSymbols && summary.topSymbols.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={summary.topSymbols}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="symbol" />
              <YAxis />
              <Tooltip 
                formatter={(value, name) => [
                  name === 'count' ? `${value} trades` : `${value.toFixed(2)}`,
                  name === 'count' ? 'Trade Count' : 'P/L'
                ]}
              />
              <Legend />
              <Bar dataKey="count" fill="#8884d8" name="Trade Count" />
              <Bar dataKey="pl" fill="#82ca9d" name="P/L" />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-gray-500 text-center py-8">No data available</p>
        )}
      </div>
      
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium mb-4">P/L by Security Type</h3>
        {summary.plByType && summary.plByType.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <PieChart>
              <Pie
                data={summary.plByType}
                cx="50%"
                cy="50%"
                labelLine={true}
                outerRadius={80}
                fill="#8884d8"
                dataKey="pl"
                nameKey="type"
                label={({type, pl}) => `${type}: ${pl.toFixed(0)}`}
              >
                {summary.plByType.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => `${value.toFixed(2)}`} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-gray-500 text-center py-8">No data available</p>
        )}
      </div>
      
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-medium mb-4">Monthly Performance</h3>
        {summary.plByMonth && summary.plByMonth.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={summary.plByMonth}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
              <Legend />
              <Line type="monotone" dataKey="pl" stroke="#8884d8" name="P/L" />
              <Line type="monotone" dataKey="tradeCount" stroke="#82ca9d" name="Trade Count" />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <p className="text-gray-500 text-center py-8">No data available</p>
        )}
      </div>
    </div>
  );

  const renderTradesTab = () => (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="p-4 border-b">
        <h3 className="text-lg font-medium">Completed Trades (Buy/Sell Pairs)</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Symbol</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Entry Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Exit Date</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Entry Price</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Exit Price</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">P/L</th>
              <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {summary.closedTrades?.slice(0, 10).map((trade, index) => (
              <tr key={index} className={index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {trade.symbol || 'N/A'}
                  {trade.callPut ? ` (${trade.callPut})` : ''}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {trade.openDate instanceof Date ? trade.openDate.toLocaleDateString() : 'N/A'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {trade.closeDate instanceof Date ? trade.closeDate.toLocaleDateString() : 'N/A'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {trade.quantity || 0}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  ${trade.openPrice?.toFixed(2) || '0.00'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  ${trade.closePrice?.toFixed(2) || '0.00'}
                </td>
                <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${
                  (trade.pl || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  ${trade.pl?.toFixed(2) || '0.00'}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                  {trade.type || 'N/A'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      <div className="p-4 border-t">
        <h3 className="text-lg font-medium mt-6 mb-4">All Transactions</h3>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Symbol</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Transaction</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Quantity</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {trades.slice(0, 10).map((trade, index) => (
                <tr key={index} className={index % 2 === 0 ? 'bg-gray-50' : 'bg-white'}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {trade.ActivityDate?.toLocaleDateString() || 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                    {trade.Symbol || 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {trade.Type || 'N/A'}
                  </td>
                  <td className={`px-6 py-4 whitespace-nowrap text-sm ${
                    trade.Transaction === 'Buy' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {trade.Transaction || 'N/A'}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    {trade.Quantity || 0}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${trade.Price?.toFixed(2) || '0.00'}
                  </td>
                  <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${
                    (trade.Amount || 0) >= 0 ? 'text-green-600' : 'text-red-600'
                  }`}>
                    ${trade.Amount?.toFixed(2) || '0.00'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderOptionsTab = () => {
    const closedTrades = summary.closedTrades || [];
    
    // Filter only options trades from closed trades
    const optionsTrades = closedTrades.filter(trade => 
      trade.callPut === 'CALL' || trade.callPut === 'PUT'
    );
    
    // Calculate options P/L by underlying
    const plByUnderlying = _.chain(optionsTrades)
      .groupBy(trade => {
        // Extract underlying from symbol or use the UnderlyingSymbol if available
        const underlyingMatch = trade.symbol.match(/^([A-Z]+)/);
        return (underlyingMatch ? underlyingMatch[1] : 'Unknown').trim();
      })
      .map((trades, underlying) => ({
        underlying: underlying || 'Unknown',
        pl: _.sumBy(trades, 'pl'),
        count: trades.length
      }))
      .sortBy(item => -item.pl)
      .value();

    // Calculate call vs put performance
    const callPutPerformance = _.chain(optionsTrades)
      .groupBy('callPut')
      .map((trades, type) => ({
        type,
        pl: _.sumBy(trades, 'pl'),
        count: trades.length,
        winRate: trades.filter(t => t.pl > 0).length / trades.length * 100
      }))
      .value();
    
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium mb-4">Options Performance by Underlying</h3>
          {plByUnderlying.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={plByUnderlying.slice(0, 8)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="underlying" />
                <YAxis />
                <Tooltip formatter={(value, name) => 
                  name === 'pl' ? `$${value.toFixed(2)}` : value
                } />
                <Legend />
                <Bar dataKey="pl" fill="#8884d8" name="P/L" />
                <Bar dataKey="count" fill="#82ca9d" name="Trade Count" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-500 text-center py-8">No options trades found</p>
          )}
        </div>
        
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-medium mb-4">Call vs Put Performance</h3>
          {callPutPerformance.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={callPutPerformance}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="type" />
                <YAxis yAxisId="left" orientation="left" stroke="#8884d8" />
                <YAxis yAxisId="right" orientation="right" stroke="#82ca9d" />
                <Tooltip />
                <Legend />
                <Bar dataKey="pl" yAxisId="left" fill="#8884d8" name="P/L ($)" />
                <Bar dataKey="winRate" yAxisId="right" fill="#82ca9d" name="Win Rate (%)" />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <p className="text-gray-500 text-center py-8">No options trades found</p>
          )}
        </div>
      </div>
    );
  };

  const renderFileUpload = () => (
    <div className="bg-white rounded-lg shadow p-6 mb-6">
      <h3 className="text-lg font-medium mb-4">Upload Trading Data</h3>
      <div className="flex flex-col items-center justify-center p-6 border-2 border-dashed border-gray-300 rounded-lg">
        <p className="text-sm text-gray-500 mb-4">
          Upload your trading data CSV file with columns for Account Number, Type, Transaction, Symbol, 
          Price, Amount, etc.
        </p>
        <input
          type="file"
          accept=".csv"
          onChange={handleFileUpload}
          className="block w-full text-sm text-gray-500
            file:mr-4 file:py-2 file:px-4
            file:rounded-full file:border-0
            file:text-sm file:font-semibold
            file:bg-blue-50 file:text-blue-700
            hover:file:bg-blue-100"
        />
        {error && (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Trader Sync Dashboard</h1>
            <p className="text-sm text-gray-600 mt-1">
              {loading ? 'Processing data...' : trades.length > 0 ? `${summary.tradeCount} trades analyzed` : 'Upload your trading data to begin'}
            </p>
          </div>
          
          {trades.length > 0 && (
            <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-4 mt-4 md:mt-0">
              <div>
                <label htmlFor="timeframe" className="block text-sm font-medium text-gray-700 mb-1">Timeframe</label>
                <select
                  id="timeframe"
                  className="block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm rounded-md"
                  value={timeframe}
                  onChange={(e) => setTimeframe(e.target.value)}
                >
                  <option value="all">All Time</option>
                  <option value="week">Last Week</option>
                  <option value="month">Last Month</option>
                  <option value="quarter">Last Quarter</option>
                </select>
              </div>
              
              <div>
                <label htmlFor="symbol" className="block text-sm font-medium text-gray-700 mb-1">Filter by Symbol</label>
                <input
                  type="text"
                  id="symbol"
                  className="block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
                  placeholder="Enter symbol..."
                  value={filterSymbol}
                  onChange={(e) => setFilterSymbol(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>
        
        {renderFileUpload()}
        
        {loading ? (
          <div className="flex justify-center items-center h-64">
            <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
          </div>
        ) : trades.length > 0 ? (
          <>
            <div className="bg-white rounded-lg shadow mb-6">
              <nav className="flex border-b">
                <button
                  onClick={() => setActiveTab('overview')}
                  className={`px-4 py-4 text-sm font-medium ${
                    activeTab === 'overview'
                      ? 'border-b-2 border-blue-500 text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Overview
                </button>
                <button
                  onClick={() => setActiveTab('trades')}
                  className={`px-4 py-4 text-sm font-medium ${
                    activeTab === 'trades'
                      ? 'border-b-2 border-blue-500 text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Recent Trades
                </button>
                <button
                  onClick={() => setActiveTab('options')}
                  className={`px-4 py-4 text-sm font-medium ${
                    activeTab === 'options'
                      ? 'border-b-2 border-blue-500 text-blue-600'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  Options Analysis
                </button>
              </nav>
            </div>
            
            <div className="mb-8">
              {activeTab === 'overview' && renderOverviewTab()}
              {activeTab === 'trades' && renderTradesTab()}
              {activeTab === 'options' && renderOptionsTab()}
            </div>
          </>
        ) : (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="text-center py-8">
              <h3 className="text-lg font-medium text-gray-900 mb-2">No Trading Data Available</h3>
              <p className="text-gray-500">
                Upload your CSV trading data file to visualize your trading performance.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;