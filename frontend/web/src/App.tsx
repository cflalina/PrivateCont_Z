import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface ContractData {
  id: string;
  name: string;
  encryptedValue: string;
  publicValue1: number;
  publicValue2: number;
  description: string;
  timestamp: number;
  creator: string;
  isVerified?: boolean;
  decryptedValue?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [contracts, setContracts] = useState<ContractData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingContract, setCreatingContract] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newContractData, setNewContractData] = useState({ 
    name: "", 
    value: "", 
    description: "",
    publicValue1: "",
    publicValue2: ""
  });
  const [selectedContract, setSelectedContract] = useState<ContractData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeFilter, setActiveFilter] = useState("all");

  const { initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const contractsList: ContractData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          contractsList.push({
            id: businessId,
            name: businessData.name,
            encryptedValue: businessId,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            description: businessData.description,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading business data:', e);
        }
      }
      
      setContracts(contractsList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const createContract = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingContract(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating contract with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const contractValue = parseInt(newContractData.value) || 0;
      const businessId = `contract-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, contractValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newContractData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newContractData.publicValue1) || 0,
        parseInt(newContractData.publicValue2) || 0,
        newContractData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Waiting for transaction confirmation..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Contract created successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewContractData({ name: "", value: "", description: "", publicValue1: "", publicValue2: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected by user" 
        : "Submission failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingContract(false); 
    }
  };

  const decryptData = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Data already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying decryption on-chain..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Data decrypted and verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Data is already verified on-chain" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed: " + (e.message || "Unknown error") });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "Contract is available and working!" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredContracts = contracts.filter(contract => {
    const matchesSearch = contract.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         contract.description.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = activeFilter === "all" || 
                         (activeFilter === "verified" && contract.isVerified) ||
                         (activeFilter === "unverified" && !contract.isVerified);
    return matchesSearch && matchesFilter;
  });

  const stats = {
    total: contracts.length,
    verified: contracts.filter(c => c.isVerified).length,
    recent: contracts.filter(c => Date.now()/1000 - c.timestamp < 60 * 60 * 24 * 7).length,
    avgValue: contracts.length > 0 ? contracts.reduce((sum, c) => sum + c.publicValue1, 0) / contracts.length : 0
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>PrivateCont_Z 🔐</h1>
            <span>隱私智能合約</span>
          </div>
          <div className="header-actions">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">🔐</div>
            <h2>Connect Wallet to Access Private Contracts</h2>
            <p>Connect your wallet to initialize the FHE encryption system and manage private smart contracts.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading encrypted contract system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>PrivateCont_Z 🔐</h1>
          <span>隱私智能合約</span>
        </div>
        
        <div className="header-actions">
          <button onClick={checkAvailability} className="test-btn">
            Test Contract
          </button>
          <button onClick={() => setShowCreateModal(true)} className="create-btn">
            + New Contract
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>
      
      <div className="main-content">
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{stats.total}</div>
            <div className="stat-label">Total Contracts</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.verified}</div>
            <div className="stat-label">Verified</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.recent}</div>
            <div className="stat-label">This Week</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{stats.avgValue.toFixed(1)}</div>
            <div className="stat-label">Avg Value</div>
          </div>
        </div>

        <div className="controls-section">
          <div className="search-filter">
            <input 
              type="text" 
              placeholder="Search contracts..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="search-input"
            />
            <div className="filter-buttons">
              <button 
                className={activeFilter === "all" ? "active" : ""}
                onClick={() => setActiveFilter("all")}
              >
                All
              </button>
              <button 
                className={activeFilter === "verified" ? "active" : ""}
                onClick={() => setActiveFilter("verified")}
              >
                Verified
              </button>
              <button 
                className={activeFilter === "unverified" ? "active" : ""}
                onClick={() => setActiveFilter("unverified")}
              >
                Unverified
              </button>
            </div>
          </div>
          <button onClick={loadData} className="refresh-btn" disabled={isRefreshing}>
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>

        <div className="contracts-list">
          {filteredContracts.length === 0 ? (
            <div className="no-contracts">
              <p>No contracts found</p>
              <button onClick={() => setShowCreateModal(true)} className="create-btn">
                Create First Contract
              </button>
            </div>
          ) : (
            filteredContracts.map((contract, index) => (
              <div 
                className={`contract-item ${contract.isVerified ? "verified" : ""}`}
                key={index}
                onClick={() => setSelectedContract(contract)}
              >
                <div className="contract-header">
                  <h3>{contract.name}</h3>
                  <span className={`status ${contract.isVerified ? "verified" : "pending"}`}>
                    {contract.isVerified ? "✅ Verified" : "🔓 Pending"}
                  </span>
                </div>
                <p className="contract-desc">{contract.description}</p>
                <div className="contract-meta">
                  <span>Value: {contract.publicValue1}</span>
                  <span>Date: {new Date(contract.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                {contract.isVerified && contract.decryptedValue && (
                  <div className="decrypted-value">
                    Decrypted: {contract.decryptedValue}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
      
      {showCreateModal && (
        <div className="modal-overlay">
          <div className="create-modal">
            <div className="modal-header">
              <h2>Create Private Contract</h2>
              <button onClick={() => setShowCreateModal(false)} className="close-btn">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>Contract Name</label>
                <input 
                  type="text" 
                  value={newContractData.name}
                  onChange={(e) => setNewContractData({...newContractData, name: e.target.value})}
                  placeholder="Enter contract name..."
                />
              </div>
              
              <div className="form-group">
                <label>Encrypted Value (Integer)</label>
                <input 
                  type="number" 
                  value={newContractData.value}
                  onChange={(e) => setNewContractData({...newContractData, value: e.target.value})}
                  placeholder="Enter value to encrypt..."
                />
                <small>This value will be FHE encrypted</small>
              </div>
              
              <div className="form-group">
                <label>Public Value 1</label>
                <input 
                  type="number" 
                  value={newContractData.publicValue1}
                  onChange={(e) => setNewContractData({...newContractData, publicValue1: e.target.value})}
                  placeholder="Enter public value..."
                />
              </div>
              
              <div className="form-group">
                <label>Description</label>
                <textarea 
                  value={newContractData.description}
                  onChange={(e) => setNewContractData({...newContractData, description: e.target.value})}
                  placeholder="Enter contract description..."
                  rows={3}
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button onClick={() => setShowCreateModal(false)} className="cancel-btn">Cancel</button>
              <button 
                onClick={createContract} 
                disabled={creatingContract || isEncrypting}
                className="submit-btn"
              >
                {creatingContract || isEncrypting ? "Creating..." : "Create Contract"}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {selectedContract && (
        <div className="modal-overlay">
          <div className="detail-modal">
            <div className="modal-header">
              <h2>Contract Details</h2>
              <button onClick={() => setSelectedContract(null)} className="close-btn">&times;</button>
            </div>
            
            <div className="modal-body">
              <div className="detail-section">
                <h3>{selectedContract.name}</h3>
                <p>{selectedContract.description}</p>
              </div>
              
              <div className="detail-grid">
                <div className="detail-item">
                  <span>Public Value 1:</span>
                  <strong>{selectedContract.publicValue1}</strong>
                </div>
                <div className="detail-item">
                  <span>Public Value 2:</span>
                  <strong>{selectedContract.publicValue2}</strong>
                </div>
                <div className="detail-item">
                  <span>Created:</span>
                  <strong>{new Date(selectedContract.timestamp * 1000).toLocaleDateString()}</strong>
                </div>
                <div className="detail-item">
                  <span>Creator:</span>
                  <strong>{selectedContract.creator.substring(0, 8)}...{selectedContract.creator.substring(36)}</strong>
                </div>
              </div>
              
              <div className="encrypted-section">
                <h4>Encrypted Data</h4>
                <div className="encrypted-status">
                  <span>Status: {selectedContract.isVerified ? "✅ Verified" : "🔒 Encrypted"}</span>
                  {selectedContract.isVerified && selectedContract.decryptedValue && (
                    <div className="decrypted-result">
                      Decrypted Value: <strong>{selectedContract.decryptedValue}</strong>
                    </div>
                  )}
                </div>
                
                <button 
                  onClick={() => decryptData(selectedContract.id)}
                  disabled={isDecrypting || fheIsDecrypting}
                  className="decrypt-btn"
                >
                  {isDecrypting || fheIsDecrypting ? "Decrypting..." : "Decrypt Value"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-toast">
          <div className={`toast-content ${transactionStatus.status}`}>
            {transactionStatus.status === "pending" && <div className="spinner"></div>}
            {transactionStatus.status === "success" && <span>✓</span>}
            {transactionStatus.status === "error" && <span>✗</span>}
            {transactionStatus.message}
          </div>
        </div>
      )}
    </div>
  );
};

export default App;