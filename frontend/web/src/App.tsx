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
  creator: string;
  timestamp: number;
  isVerified: boolean;
  decryptedValue: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [contracts, setContracts] = useState<ContractData[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingContract, setCreatingContract] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState({ 
    visible: false, 
    status: "pending" as "pending" | "success" | "error", 
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
  const [searchTerm, setSearchTerm] = useState("");
  const [userHistory, setUserHistory] = useState<any[]>([]);
  const [contractStats, setContractStats] = useState({
    total: 0,
    verified: 0,
    pending: 0
  });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevm = async () => {
      if (isConnected && !isInitialized) {
        try {
          await initialize();
        } catch (error) {
          console.error('FHEVM init failed:', error);
        }
      }
    };
    initFhevm();
  }, [isConnected, isInitialized, initialize]);

  useEffect(() => {
    if (isConnected) {
      loadData();
    } else {
      setLoading(false);
    }
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setLoading(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const contractsList: ContractData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const data = await contract.getBusinessData(businessId);
          contractsList.push({
            id: businessId,
            name: data.name,
            encryptedValue: businessId,
            publicValue1: Number(data.publicValue1),
            publicValue2: Number(data.publicValue2),
            description: data.description,
            creator: data.creator,
            timestamp: Number(data.timestamp),
            isVerified: data.isVerified,
            decryptedValue: Number(data.decryptedValue)
          });
        } catch (e) {
          console.error('Error loading contract:', e);
        }
      }
      
      setContracts(contractsList);
      updateStats(contractsList);
      updateUserHistory(contractsList);
    } catch (e) {
      showTransactionStatus("error", "Failed to load contracts");
    } finally {
      setLoading(false);
    }
  };

  const updateStats = (contractsList: ContractData[]) => {
    setContractStats({
      total: contractsList.length,
      verified: contractsList.filter(c => c.isVerified).length,
      pending: contractsList.filter(c => !c.isVerified).length
    });
  };

  const updateUserHistory = (contractsList: ContractData[]) => {
    if (!address) return;
    
    const userContracts = contractsList.filter(c => c.creator.toLowerCase() === address.toLowerCase());
    const history = userContracts.map(contract => ({
      type: 'created',
      contractId: contract.id,
      name: contract.name,
      timestamp: contract.timestamp,
      status: contract.isVerified ? 'verified' : 'pending'
    }));
    
    setUserHistory(history.sort((a, b) => b.timestamp - a.timestamp).slice(0, 10));
  };

  const showTransactionStatus = (status: "pending" | "success" | "error", message: string) => {
    setTransactionStatus({ visible: true, status, message });
    setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
  };

  const createContract = async () => {
    if (!isConnected || !address) { 
      showTransactionStatus("error", "Please connect wallet first");
      return; 
    }
    
    setCreatingContract(true);
    showTransactionStatus("pending", "Creating encrypted contract...");
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Contract not available");
      
      const value = parseInt(newContractData.value) || 0;
      const businessId = `contract-${Date.now()}`;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, value);
      
      const tx = await contract.createBusinessData(
        businessId,
        newContractData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        parseInt(newContractData.publicValue1) || 0,
        parseInt(newContractData.publicValue2) || 0,
        newContractData.description
      );
      
      showTransactionStatus("pending", "Waiting for confirmation...");
      await tx.wait();
      
      showTransactionStatus("success", "Contract created successfully!");
      await loadData();
      setShowCreateModal(false);
      setNewContractData({ name: "", value: "", description: "", publicValue1: "", publicValue2: "" });
    } catch (e: any) {
      const errorMsg = e.message?.includes("user rejected") ? "Transaction rejected" : "Creation failed";
      showTransactionStatus("error", errorMsg);
    } finally { 
      setCreatingContract(false); 
    }
  };

  const decryptContract = async (contractId: string) => {
    if (!isConnected || !address) { 
      showTransactionStatus("error", "Please connect wallet first");
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const contractData = await contractRead.getBusinessData(contractId);
      if (contractData.isVerified) {
        showTransactionStatus("success", "Contract already verified");
        await loadData();
        return Number(contractData.decryptedValue);
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValue = await contractRead.getEncryptedValue(contractId);
      
      const result = await verifyDecryption(
        [encryptedValue],
        await contractWrite.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(contractId, abiEncodedClearValues, decryptionProof)
      );
      
      showTransactionStatus("pending", "Verifying decryption...");
      
      const clearValue = result.decryptionResult.clearValues[encryptedValue];
      await loadData();
      
      showTransactionStatus("success", "Decryption verified successfully!");
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("already verified")) {
        showTransactionStatus("success", "Contract already verified");
        await loadData();
        return null;
      }
      showTransactionStatus("error", "Decryption failed");
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const available = await contract.isAvailable();
      if (available) {
        showTransactionStatus("success", "Contract is available and ready");
      }
    } catch (e) {
      showTransactionStatus("error", "Availability check failed");
    }
  };

  const filteredContracts = contracts.filter(contract =>
    contract.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contract.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
    contract.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="gear-logo">⚙️</div>
            <h1>PrivateCont_Z</h1>
            <span className="tagline">FHE智能合约平台</span>
          </div>
          <ConnectButton />
        </header>
        
        <div className="connection-prompt">
          <div className="industrial-panel">
            <div className="panel-title">🔐 隐私智能合约系统</div>
            <p>连接钱包以访问加密的智能合约平台</p>
            <div className="feature-grid">
              <div className="feature-item">
                <div className="feature-icon">🔒</div>
                <span>参数加密存储</span>
              </div>
              <div className="feature-item">
                <div className="feature-icon">⚡</div>
                <span>同态计算验证</span>
              </div>
              <div className="feature-item">
                <div className="feature-icon">🔍</div>
                <span>自动化法务执行</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="loading-screen">
        <div className="industrial-spinner"></div>
        <p>加载加密合约系统...</p>
      </div>
    );
  }

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo-section">
          <div className="gear-logo">⚙️</div>
          <h1>PrivateCont_Z</h1>
        </div>
        
        <div className="header-controls">
          <button className="industrial-btn" onClick={checkAvailability}>
            检查系统状态
          </button>
          <ConnectButton />
        </div>
      </header>

      <main className="main-content">
        <div className="control-panel">
          <div className="panel-section">
            <h3>系统控制</h3>
            <button 
              className="industrial-btn primary"
              onClick={() => setShowCreateModal(true)}
            >
              创建加密合约
            </button>
            <button className="industrial-btn" onClick={loadData}>
              刷新数据
            </button>
          </div>

          <div className="panel-section">
            <h3>数据统计</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <span className="stat-value">{contractStats.total}</span>
                <span className="stat-label">总合约数</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{contractStats.verified}</span>
                <span className="stat-label">已验证</span>
              </div>
              <div className="stat-item">
                <span className="stat-value">{contractStats.pending}</span>
                <span className="stat-label">待验证</span>
              </div>
            </div>
          </div>
        </div>

        <div className="content-area">
          <div className="search-section">
            <div className="search-box">
              <input
                type="text"
                placeholder="搜索合约名称或描述..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="industrial-input"
              />
            </div>
          </div>

          <div className="contracts-grid">
            {filteredContracts.map((contract) => (
              <div 
                key={contract.id} 
                className={`contract-card ${contract.isVerified ? 'verified' : 'pending'}`}
                onClick={() => setSelectedContract(contract)}
              >
                <div className="card-header">
                  <h4>{contract.name}</h4>
                  <span className={`status-badge ${contract.isVerified ? 'verified' : 'pending'}`}>
                    {contract.isVerified ? '✅ 已验证' : '⏳ 待验证'}
                  </span>
                </div>
                <p className="contract-desc">{contract.description}</p>
                <div className="contract-meta">
                  <span>创建者: {contract.creator.substring(0, 8)}...</span>
                  <span>时间: {new Date(contract.timestamp * 1000).toLocaleDateString()}</span>
                </div>
                {contract.isVerified && (
                  <div className="decrypted-value">
                    解密值: {contract.decryptedValue}
                  </div>
                )}
              </div>
            ))}
          </div>

          {userHistory.length > 0 && (
            <div className="history-section">
              <h3>操作历史</h3>
              <div className="history-list">
                {userHistory.map((record, index) => (
                  <div key={index} className="history-item">
                    <span className="history-type">{record.type === 'created' ? '创建' : '操作'}</span>
                    <span className="history-name">{record.name}</span>
                    <span className={`history-status ${record.status}`}>
                      {record.status === 'verified' ? '已验证' : '待验证'}
                    </span>
                    <span className="history-time">
                      {new Date(record.timestamp * 1000).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </main>

      {showCreateModal && (
        <div className="modal-overlay">
          <div className="industrial-modal">
            <div className="modal-header">
              <h3>创建加密合约</h3>
              <button onClick={() => setShowCreateModal(false)}>×</button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label>合约名称</label>
                <input
                  type="text"
                  value={newContractData.name}
                  onChange={(e) => setNewContractData({...newContractData, name: e.target.value})}
                  className="industrial-input"
                />
              </div>
              
              <div className="form-group">
                <label>加密数值 (整数)</label>
                <input
                  type="number"
                  value={newContractData.value}
                  onChange={(e) => setNewContractData({...newContractData, value: e.target.value})}
                  className="industrial-input"
                />
                <span className="input-hint">🔐 此数值将被FHE加密</span>
              </div>
              
              <div className="form-group">
                <label>公共参数 1</label>
                <input
                  type="number"
                  value={newContractData.publicValue1}
                  onChange={(e) => setNewContractData({...newContractData, publicValue1: e.target.value})}
                  className="industrial-input"
                />
              </div>
              
              <div className="form-group">
                <label>公共参数 2</label>
                <input
                  type="number"
                  value={newContractData.publicValue2}
                  onChange={(e) => setNewContractData({...newContractData, publicValue2: e.target.value})}
                  className="industrial-input"
                />
              </div>
              
              <div className="form-group">
                <label>合约描述</label>
                <textarea
                  value={newContractData.description}
                  onChange={(e) => setNewContractData({...newContractData, description: e.target.value})}
                  className="industrial-input"
                  rows={3}
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                onClick={createContract}
                disabled={creatingContract || isEncrypting}
                className="industrial-btn primary"
              >
                {creatingContract || isEncrypting ? "加密创建中..." : "创建合约"}
              </button>
              <button 
                onClick={() => setShowCreateModal(false)}
                className="industrial-btn"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedContract && (
        <div className="modal-overlay">
          <div className="industrial-modal large">
            <div className="modal-header">
              <h3>合约详情</h3>
              <button onClick={() => setSelectedContract(null)}>×</button>
            </div>
            
            <div className="modal-body">
              <div className="detail-grid">
                <div className="detail-item">
                  <label>合约ID</label>
                  <span>{selectedContract.id}</span>
                </div>
                <div className="detail-item">
                  <label>名称</label>
                  <span>{selectedContract.name}</span>
                </div>
                <div className="detail-item">
                  <label>描述</label>
                  <span>{selectedContract.description}</span>
                </div>
                <div className="detail-item">
                  <label>创建者</label>
                  <span>{selectedContract.creator}</span>
                </div>
                <div className="detail-item">
                  <label>创建时间</label>
                  <span>{new Date(selectedContract.timestamp * 1000).toLocaleString()}</span>
                </div>
                <div className="detail-item">
                  <label>公共参数 1</label>
                  <span>{selectedContract.publicValue1}</span>
                </div>
                <div className="detail-item">
                  <label>公共参数 2</label>
                  <span>{selectedContract.publicValue2}</span>
                </div>
                <div className="detail-item">
                  <label>验证状态</label>
                  <span className={`status-badge ${selectedContract.isVerified ? 'verified' : 'pending'}`}>
                    {selectedContract.isVerified ? '已验证' : '未验证'}
                  </span>
                </div>
                {selectedContract.isVerified && (
                  <div className="detail-item">
                    <label>解密数值</label>
                    <span className="decrypted-value">{selectedContract.decryptedValue}</span>
                  </div>
                )}
              </div>
              
              {!selectedContract.isVerified && (
                <div className="verification-section">
                  <button 
                    onClick={() => decryptContract(selectedContract.id)}
                    className="industrial-btn primary"
                  >
                    🔓 验证解密
                  </button>
                  <p className="hint-text">点击验证合约数据的解密结果</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          {transactionStatus.message}
        </div>
      )}
    </div>
  );
};

export default App;