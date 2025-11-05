pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PrivateCont_Z is ZamaEthereumConfig {
    
    struct ContractData {
        string clauseId;                    
        euint32 encryptedParameter;        
        uint256 publicThreshold;          
        uint256 publicPenalty;          
        string description;            
        address creator;               
        uint256 timestamp;             
        uint32 decryptedParameter; 
        bool isViolated; 
    }
    
    mapping(string => ContractData) public contractData;
    string[] public contractIds;
    
    event ContractCreated(string indexed clauseId, address indexed creator);
    event ViolationDetected(string indexed clauseId, uint32 decryptedParameter);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function createContract(
        string calldata clauseId,
        string calldata description,
        externalEuint32 encryptedParameter,
        bytes calldata inputProof,
        uint256 publicThreshold,
        uint256 publicPenalty
    ) external {
        require(bytes(contractData[clauseId].clauseId).length == 0, "Contract already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedParameter, inputProof)), "Invalid encrypted input");
        
        contractData[clauseId] = ContractData({
            clauseId: clauseId,
            encryptedParameter: FHE.fromExternal(encryptedParameter, inputProof),
            publicThreshold: publicThreshold,
            publicPenalty: publicPenalty,
            description: description,
            creator: msg.sender,
            timestamp: block.timestamp,
            decryptedParameter: 0,
            isViolated: false
        });
        
        FHE.allowThis(contractData[clauseId].encryptedParameter);
        FHE.makePubliclyDecryptable(contractData[clauseId].encryptedParameter);
        
        contractIds.push(clauseId);
        emit ContractCreated(clauseId, msg.sender);
    }
    
    function checkViolation(
        string calldata clauseId, 
        bytes memory abiEncodedClearParameter,
        bytes memory decryptionProof
    ) external {
        require(bytes(contractData[clauseId].clauseId).length > 0, "Contract does not exist");
        require(!contractData[clauseId].isViolated, "Violation already detected");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(contractData[clauseId].encryptedParameter);
        
        FHE.checkSignatures(cts, abiEncodedClearParameter, decryptionProof);
        
        uint32 decodedParameter = abi.decode(abiEncodedClearParameter, (uint32));
        
        contractData[clauseId].decryptedParameter = decodedParameter;
        
        if (decodedParameter > contractData[clauseId].publicThreshold) {
            contractData[clauseId].isViolated = true;
            emit ViolationDetected(clauseId, decodedParameter);
        }
    }
    
    function getEncryptedParameter(string calldata clauseId) external view returns (euint32) {
        require(bytes(contractData[clauseId].clauseId).length > 0, "Contract does not exist");
        return contractData[clauseId].encryptedParameter;
    }
    
    function getContractData(string calldata clauseId) external view returns (
        string memory description,
        uint256 publicThreshold,
        uint256 publicPenalty,
        address creator,
        uint256 timestamp,
        bool isViolated,
        uint32 decryptedParameter
    ) {
        require(bytes(contractData[clauseId].clauseId).length > 0, "Contract does not exist");
        ContractData storage data = contractData[clauseId];
        
        return (
            data.description,
            data.publicThreshold,
            data.publicPenalty,
            data.creator,
            data.timestamp,
            data.isViolated,
            data.decryptedParameter
        );
    }
    
    function getAllContractIds() external view returns (string[] memory) {
        return contractIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}

